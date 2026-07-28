import type { JobRecord } from "@kr8kan/agents";
import { getJob } from "@kr8kan/agents";
import { buildApplyActions } from "@kr8kan/agents/apply";
import type { Database, WorkflowRow, WorkflowRunRow } from "@kr8kan/db";
import {
  agentIdentityRepo,
  agentJobRepo,
  boardRepo,
  cardRepo,
  channelRepo,
  workflowRepo,
  workspaceRepo,
} from "@kr8kan/db";
import { createLogger } from "@kr8kan/logger";
import type {
  WorkflowStep,
  WorkflowTrigger,
  WorkflowTriggerEvent,
} from "@kr8kan/shared";
import {
  cronDueBetween,
  generateUID,
  interpolate,
  isSystemEventTrigger,
  matchesTrigger,
  parseCron,
  roleHasPermission,
  workflowStepsSchema,
  workflowTriggerSchema,
} from "@kr8kan/shared";

import { applyJobActions } from "./agentApply";
import { writeBoardNoteSerialized } from "./boardNoteWrites";
import { evalBlocksApply } from "./evalGate";
import { applyJobPatch } from "./patchApply";
import { audit } from "./audit";
import {
  withAgentBrowser,
  workflowArtifactDir,
  writeShot,
} from "./browserSession";
import { publishLive } from "./liveEvents";
import {
  dispatchWorker,
  registerSystemEventSink,
  waitForJob,
} from "./dispatchWorker";
import { dispatchWebhookEvent } from "./webhooks";

const logger = createLogger("workflow");

/**
 * Buzz-inspired workflow executor. Triggers fire from the app's choke
 * points (card mutations, comments, reactions, scheduler, webhook route);
 * steps run sequentially in-process; gate steps park the run in the DB
 * (waiting_gate) until a reaction resumes it — restart-safe by design.
 *
 * Loop guards: events caused by a workflow run carry its id and never
 * trigger another workflow (no chains in v1); max 20 runs/workflow/hour;
 * max 10 steps (schema-enforced).
 */

const MAX_RUNS_PER_HOUR = 20;
const WORKER_WAIT_MS = 20 * 60 * 1000;
const WEBHOOK_TIMEOUT_MS = 10_000;
/** checkUrl / captureScreenshot steps drive a real browser session and can
 * hang indefinitely on a wedged page; cap them so a stuck step fails the
 * step (not the whole process) instead of blocking the run forever. */
const STEP_BROWSER_TIMEOUT_MS = 90_000;

interface StepResult {
  step: number;
  type: string;
  ok: boolean;
  detail?: string;
  jobId?: string;
}

function parseTrigger(raw: unknown): WorkflowTrigger | null {
  const parsed = workflowTriggerSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function parseSteps(raw: unknown): WorkflowStep[] | null {
  const parsed = workflowStepsSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Races a step body against STEP_BROWSER_TIMEOUT_MS. On timeout resolves
 * to the sentinel rather than rejecting, so callers can fail the step
 * cleanly (ok:false) instead of blocking the run. */
const STEP_TIMEOUT = Symbol("step-timeout");
function withStepTimeout<T>(promise: Promise<T>): Promise<T | typeof STEP_TIMEOUT> {
  return Promise.race([
    promise,
    new Promise<typeof STEP_TIMEOUT>((resolve) =>
      setTimeout(() => resolve(STEP_TIMEOUT), STEP_BROWSER_TIMEOUT_MS),
    ),
  ]);
}

/** Fire-and-forget trigger fan-out. Cheap by construction: one indexed
 * query per event, matching in memory. */
export function fireTrigger(db: Database, event: WorkflowTriggerEvent): void {
  if (event.workflowRunId) return; // no workflow-triggers-workflow chains
  void (async () => {
    const candidates = await workflowRepo.listWorkflows(db, event.workspaceId, {
      enabledOnly: true,
    });
    for (const workflow of candidates) {
      if (
        workflow.boardPublicId &&
        event.boardPublicId &&
        workflow.boardPublicId !== event.boardPublicId
      ) {
        continue;
      }
      // A workflow never reacts to its own failed run.
      if (
        event.failedWorkflowPublicId &&
        workflow.publicId === event.failedWorkflowPublicId
      ) {
        continue;
      }
      const trigger = parseTrigger(workflow.trigger);
      if (!trigger || !matchesTrigger(trigger, event)) continue;
      await startRun(db, workflow, event);
    }
  })().catch((err: unknown) => {
    logger.error({ err, type: event.type }, "trigger fan-out failed");
  });
}

// Failed jobs report in through this sink (a callback because this module
// already imports dispatchWorker). Sink events are plain trigger events.
registerSystemEventSink((db, event) => fireTrigger(db, event));

export async function startRun(
  db: Database,
  workflow: WorkflowRow,
  event: WorkflowTriggerEvent,
): Promise<WorkflowRunRow | null> {
  const recent = await workflowRepo.countRecentRuns(db, workflow.id, 3600_000);
  if (recent >= MAX_RUNS_PER_HOUR) {
    logger.warn(
      { workflow: workflow.publicId, recent },
      "workflow rate-limited (20 runs/hour)",
    );
    return null;
  }
  const steps = parseSteps(workflow.steps);
  if (!steps) {
    logger.error({ workflow: workflow.publicId }, "workflow has invalid steps");
    return null;
  }
  const run = await workflowRepo.createRun(db, {
    workflowId: workflow.id,
    workspaceId: workflow.workspaceId,
    triggerEvent: event,
    cardPublicId: event.cardPublicId ?? null,
  });
  if (!run) return null;
  // Best-effort rate-cap tightening: count-then-create above already has
  // a race window (no transactions on NCB), so re-count after the insert
  // and back the run out if we lost the race and overshot the cap. Still
  // not airtight — two concurrent starts can both pass this second check
  // — but it shrinks the overshoot window from the whole create() round
  // trip down to nothing.
  const recentAfter = await workflowRepo.countRecentRuns(db, workflow.id, 3600_000);
  if (recentAfter > MAX_RUNS_PER_HOUR) {
    logger.warn(
      { workflow: workflow.publicId, recentAfter },
      "workflow rate cap exceeded after create (race) — failing the run",
    );
    await failRun(
      db,
      workflow,
      run,
      [],
      `rate cap exceeded: ${recentAfter} runs in the last hour (max ${MAX_RUNS_PER_HOUR})`,
    );
    return run;
  }
  await workflowRepo.updateWorkflow(db, workflow.id, { lastFiredAt: new Date() });
  audit(db, {
    workspaceId: workflow.workspaceId,
    eventType: "workflow.run.started",
    entityType: "workflow_run",
    entityPublicId: run.publicId,
    actorUserId: event.actorUserId ?? workflow.createdBy,
    payload: { workflow: workflow.name, trigger: event.type },
  });
  void executeFrom(db, workflow, run, steps, event, 0, []).catch(
    (err: unknown) => logger.error({ err, run: run.publicId }, "run crashed"),
  );
  return run;
}

async function loadScope(
  db: Database,
  event: WorkflowTriggerEvent,
  workflow: WorkflowRow,
  results: StepResult[],
  jobCache?: Map<string, JobRecord>,
): Promise<Record<string, unknown>> {
  let card: Record<string, unknown> | undefined;
  if (event.cardPublicId) {
    const row = await cardRepo.getCardWithBoard(db, event.cardPublicId);
    if (row) card = { publicId: row.publicId, title: row.title, list: row.list.name };
  }
  const steps: Record<string, unknown>[] = [];
  for (const r of results) {
    let result: unknown;
    let raw: string | undefined;
    if (r.jobId) {
      // Prefer the in-memory record the runner handed the settle waiter —
      // a store re-read here lands inside NCB's read-after-write lag and
      // returns the pre-terminal row with result/resultParsed still NULL.
      let job = jobCache?.get(r.jobId) ?? (await getJob(r.jobId));
      // NCB read lag — same class as the runWorker wait fix. Jobs not in
      // the cache (gate resume, hot reload) can read back "completed but
      // no result"; never render blank off a stale read (bounded).
      for (
        let retry = 0;
        job &&
        job.status === "completed" &&
        !job.parseError &&
        job.resultParsed === undefined &&
        job.result === undefined &&
        retry < 3;
        retry++
      ) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        job = (await getJob(r.jobId)) ?? job;
      }
      result = job?.resultParsed ?? job?.result;
      raw = job?.result;
    }
    steps.push({ ok: r.ok, detail: r.detail, result, raw });
  }
  return {
    card,
    board: { publicId: event.boardPublicId },
    trigger: event,
    steps,
    workflow: { name: workflow.name },
  };
}

/** References like `{{steps.0.result.whatFailed}}` interpolate to "" when
 * the step's structured parse failed (result is the raw string, and the
 * interpolator cannot descend into a string). Rather than posting a
 * structurally blank note/comment/message, append that step's raw worker
 * output once so the finding degrades to readable text instead of
 * vanishing. */
const STEP_RESULT_FIELD_RE = /\{\{\s*steps\.(\d+)\.result\./g;
function withRawFallback(
  body: string,
  template: string,
  scope: Record<string, unknown>,
): string {
  const steps = scope.steps as
    | Array<{ result?: unknown; raw?: string }>
    | undefined;
  if (!steps) return body;
  const appended = new Set<number>();
  let out = body;
  for (const match of template.matchAll(STEP_RESULT_FIELD_RE)) {
    const idx = Number(match[1]);
    if (appended.has(idx)) continue;
    const step = steps[idx];
    if (!step?.raw) continue;
    // Object results resolve their own fields — nothing to rescue.
    if (step.result !== null && typeof step.result === "object") continue;
    appended.add(idx);
    out += `\n\n> Structured output unavailable — raw worker output:\n\n${step.raw.slice(0, 4000)}`;
  }
  return out;
}

export { serializeBoardNoteWrite } from "./boardNoteWrites";

async function executeFrom(
  db: Database,
  workflow: WorkflowRow,
  run: WorkflowRunRow,
  steps: WorkflowStep[],
  event: WorkflowTriggerEvent,
  startStep: number,
  priorResults: StepResult[],
  operatorOverride?: string,
): Promise<void> {
  const operator = operatorOverride ?? event.actorUserId ?? workflow.createdBy;
  if (!operator) {
    await failRun(db, workflow, run, priorResults, "workflow has no responsible user");
    return;
  }
  const results = [...priorResults];
  // Settled in-memory job records, keyed by job public id: loadScope must
  // never have to re-read a job this invocation already holds — the store
  // read lands inside NCB's read-after-write lag and drops the result.
  const jobCache = new Map<string, JobRecord>();

  const fail = (i: number, type: string, detail: string) => {
    results.push({ step: i, type, ok: false, detail });
    return failRun(db, workflow, run, results, `step ${i} (${type}): ${detail}`);
  };

  for (let i = startStep; i < steps.length; i++) {
    const step = steps[i]!;
    await workflowRepo.updateRun(db, run.id, {
      currentStep: i,
      stepResults: results,
    });
    const scope = await loadScope(db, event, workflow, results, jobCache);

    switch (step.type) {
      case "runWorker": {
        let job: JobRecord;
        try {
          job = await dispatchWorker(db, { id: operator }, {
            worker: step.worker,
            cardPublicId: event.cardPublicId,
            boardPublicId: event.boardPublicId,
            prompt: step.promptTemplate
              ? interpolate(step.promptTemplate, scope)
              : undefined,
            // Run lineage doubles as the recursion guard: jobs dispatched
            // by a workflow never fire job.failed / job.verify_failed.
            workflowRunId: run.publicId,
            // Sentinel runs hand the failed job to the worker as evidence.
            diagnoseJobId:
              (event.type === "job.failed" || event.type === "job.verify_failed") &&
              event.jobId
                ? event.jobId
                : undefined,
          });
        } catch (err) {
          await fail(i, step.type, err instanceof Error ? err.message : "dispatch failed");
          return;
        }
        let finished = await waitForJob(job.id, WORKER_WAIT_MS);
        // NCB read-after-write lag: the record handed to the settle waiter
        // is read back from the store, which can still say "running" for a
        // beat after the runner's terminal write. A run must never be
        // failed off a stale read — re-read the job row until a terminal
        // status appears (bounded).
        for (
          let retry = 0;
          finished?.status === "running" && retry < 5;
          retry++
        ) {
          await new Promise((r) => setTimeout(r, 1000));
          const fresh = await agentJobRepo.getJobByPublicId(db, job.id);
          if (fresh && finished) {
            finished = { ...finished, status: fresh.status, error: fresh.error ?? undefined };
          }
        }
        if (!finished || finished.status !== "completed") {
          await fail(
            i,
            step.type,
            `job ${job.id} ${finished?.status ?? "timed out"}: ${finished?.error ?? ""}`,
          );
          return;
        }
        jobCache.set(finished.id, finished);
        results.push({ step: i, type: step.type, ok: true, jobId: finished.id });
        break;
      }

      case "gate": {
        if (!event.cardPublicId && !event.channelPublicId) {
          await fail(i, step.type, "gate requires a card- or channel-scoped run");
          return;
        }
        const identity = await agentIdentityRepo.ensureIdentity(
          db,
          workflow.workspaceId,
          "workflow",
          { displayName: "Workflow", avatar: "⚙️" },
        );
        const pendingSummary = summarizePendingApply(steps, i, results);
        const body = [
          `**Approval needed** — workflow *${workflow.name}*`,
          step.message ? interpolate(step.message, scope) : null,
          pendingSummary,
          `React ${step.emoji} to approve or ❌ to reject. Expires in ${step.timeoutHours}h.`,
          `\`wfrun:${run.publicId}\``,
        ]
          .filter(Boolean)
          .join("\n\n");
        let gateCommentPublicId: string | null = null;
        let gateMessagePublicId: string | null = null;
        if (event.cardPublicId) {
          const card = await cardRepo.getCardWithBoard(db, event.cardPublicId);
          if (!card) {
            await fail(i, step.type, "card vanished before gate");
            return;
          }
          const comment = await cardRepo.addComment(db, {
            cardId: card.id,
            comment: body,
            userId: operator,
            agentIdentityId: identity.id,
          });
          gateCommentPublicId = comment?.publicId ?? null;
        } else {
          // Channel-scoped run (message.posted): the gate parks in the
          // triggering message's thread.
          const posted = await postWorkflowMessage(db, {
            workspaceId: workflow.workspaceId,
            channelPublicId: event.channelPublicId!,
            threadOfMessagePublicId: event.messagePublicId,
            body,
            operator,
            identityId: identity.id,
          });
          if (!posted) {
            await fail(i, step.type, "channel vanished before gate");
            return;
          }
          gateMessagePublicId = posted.publicId;
        }
        results.push({ step: i, type: step.type, ok: true, detail: "waiting" });
        await workflowRepo.updateRun(db, run.id, {
          status: "waiting_gate",
          currentStep: i,
          stepResults: results,
          gateCommentPublicId,
          gateMessagePublicId,
          gateExpiresAt: new Date(Date.now() + step.timeoutHours * 3600_000),
          // A run parking at a NEW gate must not carry a stale claim
          // token from a previous gate's resume race.
          gateClaim: null,
        });
        audit(db, {
          workspaceId: workflow.workspaceId,
          eventType: "workflow.gate.opened",
          entityType: "workflow_run",
          entityPublicId: run.publicId,
          actorAgentId: identity.id,
          payload: { workflow: workflow.name, step: i, emoji: step.emoji },
        });
        dispatchWebhookEvent(db, workflow.workspaceId, "workflow.gate.opened", {
          workflow: { publicId: workflow.publicId, name: workflow.name },
          run: { publicId: run.publicId },
          card: { publicId: event.cardPublicId },
        });
        return; // parked — a reaction resumes via resumeRunFromGate
      }

      case "applyPreset": {
        const lastWorker = [...results]
          .reverse()
          .find((r) => r.type === "runWorker" && r.ok && r.jobId);
        if (!lastWorker?.jobId) {
          await fail(i, step.type, "no completed runWorker step before apply");
          return;
        }
        let job = jobCache.get(lastWorker.jobId) ?? (await getJob(lastWorker.jobId));
        // NCB read lag (same class as the runWorker wait fix): a completed
        // job's result_parsed can trail the status write. Never fail an
        // apply off a read that shows "completed but no result" — re-read
        // briefly before concluding the result is truly missing.
        for (
          let retry = 0;
          job &&
          job.status === "completed" &&
          !job.parseError &&
          job.resultParsed === undefined &&
          retry < 5;
          retry++
        ) {
          await new Promise((r) => setTimeout(r, 1000));
          job = await getJob(lastWorker.jobId);
        }
        if (!job || job.parseError || job.resultParsed === undefined) {
          await fail(
            i,
            step.type,
            `job ${lastWorker.jobId} has no parsed result (${job?.parseError ?? "missing"})`,
          );
          return;
        }
        const preset = buildApplyActions(
          job.schemaWorker ?? job.worker,
          job.resultParsed,
          {
            boardPublicId: event.boardPublicId,
            cardPublicId: event.cardPublicId,
            resultRaw: job.result,
          },
        );
        if (!preset || preset.actions.length === 0) {
          await fail(i, step.type, "worker result has no applyable preset");
          return;
        }
        try {
          const applied = await applyJobActions(db, operator, job, preset.actions, {
            enforceGrounding: true,
          });
          results.push({
            step: i,
            type: step.type,
            ok: true,
            detail: `${applied.applied.length} actions`,
            jobId: job.id,
          });
        } catch (err) {
          await fail(i, step.type, err instanceof Error ? err.message : "apply failed");
          return;
        }
        break;
      }

      case "postComment": {
        // Card-less triggers (schedule/webhook) post to the step's fixed
        // target card; card-scoped triggers default to the event's card.
        const targetCardPublicId = step.targetCardPublicId ?? event.cardPublicId;
        if (!targetCardPublicId) {
          await fail(
            i,
            step.type,
            "postComment needs a card: card-scoped trigger or a target card on the step",
          );
          return;
        }
        const card = await cardRepo.getCardWithBoard(db, targetCardPublicId);
        if (!card) {
          await fail(i, step.type, "target card not found");
          return;
        }
        if (card.list.board.workspaceId !== workflow.workspaceId) {
          await fail(i, step.type, "target card is outside this workspace");
          return;
        }
        const identity = await agentIdentityRepo.ensureIdentity(
          db,
          workflow.workspaceId,
          "workflow",
          { displayName: "Workflow", avatar: "⚙️" },
        );
        await cardRepo.addComment(db, {
          cardId: card.id,
          comment: withRawFallback(
            interpolate(step.bodyTemplate, scope),
            step.bodyTemplate,
            scope,
          ),
          userId: operator,
          agentIdentityId: identity.id,
        });
        results.push({ step: i, type: step.type, ok: true });
        break;
      }

      case "postNote": {
        // Board-scoped: lands on the workflow's board notes doc. No card
        // needed — this is the home for schedule-driven digests.
        const boardPublicId = event.boardPublicId ?? workflow.boardPublicId;
        if (!boardPublicId) {
          await fail(i, step.type, "postNote needs a board on the workflow");
          return;
        }
        const board = await boardRepo.getBoardByPublicId(db, boardPublicId);
        if (!board || board.workspaceId !== workflow.workspaceId) {
          await fail(i, step.type, "board not found in this workspace");
          return;
        }
        const identity = await agentIdentityRepo.ensureIdentity(
          db,
          workflow.workspaceId,
          "workflow",
          { displayName: "Workflow", avatar: "⚙️" },
        );
        const body = withRawFallback(
          interpolate(step.bodyTemplate, scope),
          step.bodyTemplate,
          scope,
        );
        // Serialized per board with read-your-writes (S7): unserialized,
        // two concurrent appends read the same base and one vanishes; even
        // serialized, an NCB stale read can echo the pre-write note.
        await writeBoardNoteSerialized(db, {
          boardId: board.id,
          body,
          mode: step.mode === "append" ? "append" : "replace",
          separatorLabel: workflow.name,
          userId: operator,
          agentIdentityId: identity.id,
        });
        audit(db, {
          workspaceId: workflow.workspaceId,
          eventType: "board.note.updated",
          entityType: "board",
          entityPublicId: board.publicId,
          actorUserId: operator,
          actorAgentId: identity.id,
          payload: { workflow: workflow.name, mode: step.mode },
        });
        results.push({ step: i, type: step.type, ok: true, detail: step.mode });
        break;
      }

      case "postMessage": {
        // Channel-scoped triggers default to the triggering channel;
        // everything else needs the step's explicit target.
        const channelPublicId = step.channelPublicId ?? event.channelPublicId;
        if (!channelPublicId) {
          await fail(
            i,
            step.type,
            "postMessage needs a channel: message-scoped trigger or a target channel on the step",
          );
          return;
        }
        const identity = await agentIdentityRepo.ensureIdentity(
          db,
          workflow.workspaceId,
          "workflow",
          { displayName: "Workflow", avatar: "⚙️" },
        );
        const posted = await postWorkflowMessage(db, {
          workspaceId: workflow.workspaceId,
          channelPublicId,
          // Replies stay in the triggering thread only when posting back
          // to the same channel the event came from.
          threadOfMessagePublicId:
            channelPublicId === event.channelPublicId
              ? event.messagePublicId
              : undefined,
          body: withRawFallback(
            interpolate(step.bodyTemplate, scope),
            step.bodyTemplate,
            scope,
          ),
          operator,
          identityId: identity.id,
        });
        if (!posted) {
          await fail(i, step.type, "target channel not found in this workspace");
          return;
        }
        results.push({ step: i, type: step.type, ok: true });
        break;
      }

      case "callWebhook": {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
          const res = await fetch(step.url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              workflow: workflow.name,
              run: run.publicId,
              trigger: event.type,
              cardPublicId: event.cardPublicId ?? null,
            }),
            signal: controller.signal,
          });
          clearTimeout(timer);
          results.push({
            step: i,
            type: step.type,
            ok: res.ok,
            detail: `HTTP ${res.status}`,
          });
          if (!res.ok) {
            await failRun(db, workflow, run, results, `webhook returned ${res.status}`);
            return;
          }
        } catch (err) {
          await fail(i, step.type, err instanceof Error ? err.message : "fetch failed");
          return;
        }
        break;
      }

      case "checkUrl": {
        try {
          const verdict = await withStepTimeout(withAgentBrowser(
            { jobId: run.publicId, workspaceId: workflow.workspaceId },
            async (browser) => {
              const goto = await browser.execute({
                type: "goto",
                url: step.url,
              });
              if (!goto.ok) {
                return { ok: false, detail: goto.error ?? "navigation failed" };
              }
              const snap = await browser.execute({ type: "snapshot" });
              const text = snap.ok
                ? ((snap.data as { text?: string }).text ?? "")
                : "";
              if (step.expectText && !text.includes(step.expectText)) {
                return {
                  ok: false,
                  detail: `page did not contain "${step.expectText}"`,
                };
              }
              const consoleResult = await browser.execute({
                type: "console",
                level: "error",
              });
              const errors = consoleResult.ok
                ? (consoleResult.data as Array<{ text: string }>)
                : [];
              if (!step.allowConsoleErrors && errors.length > 0) {
                return {
                  ok: false,
                  detail: `${errors.length} console error(s): ${errors[0]?.text ?? ""}`.slice(
                    0,
                    300,
                  ),
                };
              }
              return {
                ok: true,
                detail: `page healthy${errors.length ? ` (${errors.length} console error(s) allowed)` : ""}`,
              };
            },
          ));
          if (verdict === STEP_TIMEOUT) {
            await fail(i, step.type, `step timed out after 90s`);
            return;
          }
          if (!verdict.ok) {
            await fail(i, step.type, verdict.detail);
            return;
          }
          results.push({
            step: i,
            type: step.type,
            ok: true,
            detail: verdict.detail,
          });
        } catch (err) {
          await fail(
            i,
            step.type,
            err instanceof Error ? err.message : "browser check failed",
          );
          return;
        }
        break;
      }

      case "captureScreenshot": {
        try {
          const detail = await withStepTimeout(withAgentBrowser(
            { jobId: run.publicId, workspaceId: workflow.workspaceId },
            async (browser) => {
              const goto = await browser.execute({
                type: "goto",
                url: step.url,
              });
              if (!goto.ok) throw new Error(goto.error ?? "navigation failed");
              const shot = await browser.execute({
                type: "screenshot",
                fullPage: step.fullPage,
                preset: step.preset,
              });
              if (!shot.ok) throw new Error(shot.error ?? "capture failed");
              const image = shot.data as {
                data: string;
                width: number;
                height: number;
              };
              const written = writeShot(
                workflowArtifactDir(run.publicId),
                `step-${i}-${step.preset ?? "viewport"}`,
                image.data,
                image.width,
                image.height,
              );
              return `${written.width}×${written.height}, ${Math.round(written.bytes / 1024)} KB → ${written.path}`;
            },
          ));
          if (detail === STEP_TIMEOUT) {
            await fail(i, step.type, `step timed out after 90s`);
            return;
          }
          results.push({ step: i, type: step.type, ok: true, detail });
        } catch (err) {
          await fail(
            i,
            step.type,
            err instanceof Error ? err.message : "screenshot failed",
          );
          return;
        }
        break;
      }
    }
  }

  await workflowRepo.updateRun(db, run.id, {
    status: "completed",
    stepResults: results,
    currentStep: steps.length,
    completedAt: new Date(),
  });
  audit(db, {
    workspaceId: workflow.workspaceId,
    eventType: "workflow.run.completed",
    entityType: "workflow_run",
    entityPublicId: run.publicId,
    actorUserId: operator,
    payload: { workflow: workflow.name, steps: results.length },
  });
  logger.info(
    { run: run.publicId, workflow: workflow.name, steps: results.length },
    "workflow run completed",
  );
}

/**
 * Post to a channel as the workflow identity. Workspace-checked,
 * archived-channel-refusing, audited as message.posted. Replies attach
 * to the given message's thread root (one-level semantics). Returns the
 * created message or null when the channel is unusable.
 */
async function postWorkflowMessage(
  db: Database,
  input: {
    workspaceId: number;
    channelPublicId: string;
    threadOfMessagePublicId?: string;
    body: string;
    operator: string;
    identityId: number;
  },
): Promise<{ publicId: string } | null> {
  const channel = await channelRepo.getChannelByPublicId(
    db,
    input.channelPublicId,
  );
  if (!channel || channel.workspaceId !== input.workspaceId) return null;
  if (channel.archivedAt) return null;
  let parentMessageId: number | undefined;
  if (input.threadOfMessagePublicId) {
    const source = await channelRepo.getMessageByPublicId(
      db,
      input.threadOfMessagePublicId,
    );
    if (source && source.channelId === channel.id) {
      parentMessageId = source.parentMessageId ?? source.id;
    }
  }
  const message = await channelRepo.addMessage(db, {
    channelId: channel.id,
    body: input.body,
    userId: input.operator,
    agentIdentityId: input.identityId,
    parentMessageId,
  });
  if (!message) return null;
  audit(db, {
    workspaceId: input.workspaceId,
    eventType: "message.posted",
    entityType: "message",
    entityPublicId: message.publicId,
    actorUserId: input.operator,
    actorAgentId: input.identityId,
    payload: { channel: channel.publicId, viaWorkflow: true },
  });
  publishLive(input.workspaceId, {
    type: "message.posted",
    channelPublicId: channel.publicId,
    messagePublicId: message.publicId,
  });
  return { publicId: message.publicId };
}

function summarizePendingApply(
  steps: WorkflowStep[],
  gateIndex: number,
  results: StepResult[],
): string | null {
  const next = steps[gateIndex + 1];
  if (next?.type !== "applyPreset") return null;
  const lastWorker = [...results]
    .reverse()
    .find((r) => r.type === "runWorker" && r.ok);
  return lastWorker
    ? `Approving applies the result of job \`${lastWorker.jobId}\` to this card.`
    : null;
}

async function failRun(
  db: Database,
  workflow: WorkflowRow,
  run: WorkflowRunRow,
  results: StepResult[],
  error: string,
): Promise<void> {
  await workflowRepo.updateRun(db, run.id, {
    status: "failed",
    stepResults: results,
    error,
    completedAt: new Date(),
  });
  audit(db, {
    workspaceId: workflow.workspaceId,
    eventType: "workflow.run.failed",
    entityType: "workflow_run",
    entityPublicId: run.publicId,
    payload: { workflow: workflow.name, error },
  });
  dispatchWebhookEvent(db, workflow.workspaceId, "workflow.run.failed", {
    workflow: { publicId: workflow.publicId, name: workflow.name },
    run: { publicId: run.publicId },
    error,
  });
  logger.warn({ run: run.publicId, error }, "workflow run failed");
  // Sentinel loop, depth-1 guard: a run that was itself started by a
  // system event (a failing diagnostician, say) never fires another one.
  const triggerType = (run.triggerEvent as WorkflowTriggerEvent | null)?.type;
  if (!isSystemEventTrigger(triggerType)) {
    fireTrigger(db, {
      type: "workflow.run.failed",
      workspaceId: workflow.workspaceId,
      boardPublicId: workflow.boardPublicId ?? undefined,
      cardPublicId: run.cardPublicId ?? undefined,
      error,
      failedWorkflowPublicId: workflow.publicId,
      failedRunPublicId: run.publicId,
    });
  }
}

/**
 * Gate expiry: fail the run AND tell the card — the gate comment would
 * otherwise keep asking for a reaction forever. Comment posting is
 * best-effort (missing card / null creator never fails the sweep).
 */
async function expireGate(
  db: Database,
  workflow: WorkflowRow,
  run: WorkflowRunRow,
): Promise<void> {
  // Callers (the scheduler's expiry sweep, and the expiry checks inside
  // handleGateReaction/rejectGateWithReason) all pass in a `run` that may
  // have been read moments ago. Re-read fresh and bail if an in-flight
  // approval already resolved (or claimed) the gate — otherwise the
  // expiry sweep can fail a run a concurrent approval just resumed.
  const fresh = await workflowRepo.getRunByPublicId(db, run.publicId);
  if (!fresh || fresh.status !== "waiting_gate" || fresh.gateClaim) return;

  await failRun(
    db,
    workflow,
    fresh,
    (fresh.stepResults ?? []) as StepResult[],
    "gate expired",
  );
  if (!workflow.createdBy) return;
  const notice = `⏳ Approval expired — workflow *${workflow.name}* stopped (run \`wfrun:${run.publicId}\`).`;
  try {
    const identity = await agentIdentityRepo.ensureIdentity(
      db,
      workflow.workspaceId,
      "workflow",
      { displayName: "Workflow", avatar: "⚙️" },
    );
    if (run.cardPublicId) {
      const card = await cardRepo.getCardWithBoard(db, run.cardPublicId);
      if (!card) return;
      await cardRepo.addComment(db, {
        cardId: card.id,
        comment: notice,
        userId: workflow.createdBy,
        agentIdentityId: identity.id,
      });
    } else if (run.gateMessagePublicId) {
      // Channel gate: the expiry notice lands in the gate's own thread.
      const gateMessage = await channelRepo.getMessageByPublicId(
        db,
        run.gateMessagePublicId,
      );
      if (!gateMessage) return;
      const expiryMessage = await channelRepo.addMessage(db, {
        channelId: gateMessage.channelId,
        body: notice,
        userId: workflow.createdBy,
        agentIdentityId: identity.id,
        parentMessageId: gateMessage.parentMessageId ?? gateMessage.id,
      });
      if (expiryMessage) {
        publishLive(workflow.workspaceId, {
          type: "message.posted",
          channelPublicId: gateMessage.channel.publicId,
          messagePublicId: expiryMessage.publicId,
        });
      }
    }
  } catch (err) {
    logger.warn({ run: run.publicId, err }, "gate-expiry notice failed");
  }
}

/* ── gate resolution (called from the reaction mutations) ────────── */

/** Where a gate reaction landed: a card comment (plain string, the
 * historical shape) or a channel message. */
export type GateTarget = string | { messagePublicId: string };

function resolveGateRun(db: Database, target: GateTarget) {
  return typeof target === "string"
    ? workflowRepo.getRunByGateComment(db, target)
    : workflowRepo.getRunByGateMessage(db, target.messagePublicId);
}

/**
 * Double-fire guard for gate resolution (approve/reject). NCB has no
 * compare-and-set and its read-after-update can return stale rows, so a
 * write-then-reread token check both misses real races and — worse —
 * swallows legitimate approvals while leaving a persisted claim behind
 * that deadlocks the gate. The engine is single-instance by design
 * (in-process runner), so the authoritative mutex is this in-process
 * set, keyed per gate instance (run + step): a given gate can only ever
 * be claimed once per process lifetime. The persisted gateClaim remains
 * as a restart-visible marker only. A persisted claim on a run still
 * parked at waiting_gate means a previous approval crashed or the
 * process restarted mid-resume — re-claiming then is recovery, not a
 * race; resolved gates cannot re-claim at all because resolution clears
 * the gate comment/message link the lookup depends on.
 */
const claimedGates = new Set<string>();
async function claimGate(
  db: Database,
  run: WorkflowRunRow,
): Promise<boolean> {
  const key = `${run.id}:${run.currentStep}`;
  if (claimedGates.has(key)) return false;
  claimedGates.add(key);
  const fresh = await workflowRepo.getRunByPublicId(db, run.publicId);
  if (!fresh || fresh.status !== "waiting_gate") return false;
  await workflowRepo.updateRun(db, run.id, { gateClaim: generateUID() });
  return true;
}

/**
 * If this reaction targets a live gate comment or gate message, resolve
 * it. Approver permissions are re-checked NOW (not at gate creation):
 * the reactor must satisfy the gate's approver spec, and the gated apply
 * re-checks per-action permissions against the approver inside
 * applyJobActions. Returns true when the reaction was consumed by a gate.
 */
export async function handleGateReaction(
  db: Database,
  user: { id: string },
  target: GateTarget,
  emoji: string,
): Promise<boolean> {
  const run = await resolveGateRun(db, target);
  if (!run) return false;
  const workflow = run.workflow;
  const steps = parseSteps(workflow.steps);
  const gateStep = steps?.[run.currentStep];
  if (!steps || gateStep?.type !== "gate") return false;

  const approve = emoji === gateStep.emoji;
  const reject = emoji === "❌";
  if (!approve && !reject) return false;

  const membership = await workspaceRepo.getMembership(
    db,
    user.id,
    run.workspaceId,
  );
  if (!membership) return false;
  if (gateStep.approvers === "admin" && membership.role !== "admin") return false;
  if (!roleHasPermission(membership.role, "agent:run")) return false;

  if (run.gateExpiresAt && run.gateExpiresAt < new Date()) {
    await expireGate(db, workflow, run);
    return true;
  }

  // Claim before acting: if another concurrent reaction already won the
  // claim, treat this one as handled and stop — this is what prevents
  // two concurrent approvals from both resuming (or resolving) the gate.
  if (!(await claimGate(db, run))) return true;

  const results = ((run.stepResults ?? []) as StepResult[]).map((r) =>
    r.step === run.currentStep
      ? { ...r, detail: approve ? `approved by ${user.id}` : `rejected by ${user.id}` }
      : r,
  );

  audit(db, {
    workspaceId: run.workspaceId,
    eventType: approve ? "workflow.gate.approved" : "workflow.gate.rejected",
    entityType: "workflow_run",
    entityPublicId: run.publicId,
    actorUserId: user.id,
    payload: { workflow: workflow.name, step: run.currentStep },
  });

  if (reject) {
    await workflowRepo.updateRun(db, run.id, {
      // Distinct terminal status: a human rejection is neither a success
      // ("completed") nor a system failure ("failed" — which would fire
      // the workflow.run.failed webhook and the sentinel trigger loop).
      status: "rejected",
      stepResults: results,
      gateCommentPublicId: null,
      gateMessagePublicId: null,
      gateExpiresAt: null,
      gateClaim: null,
      error: "gate rejected",
      completedAt: new Date(),
    });
    dispatchWebhookEvent(db, run.workspaceId, "workflow.gate.rejected", {
      workflow: { publicId: workflow.publicId, name: workflow.name },
      run: { publicId: run.publicId },
    });
    return true;
  }

  await workflowRepo.updateRun(db, run.id, {
    status: "running",
    stepResults: results,
    gateCommentPublicId: null,
    gateMessagePublicId: null,
    gateExpiresAt: null,
    gateClaim: null,
  });
  const event = (run.triggerEvent ?? {}) as WorkflowTriggerEvent;
  // The approver becomes the operator for everything after the gate —
  // they are the human authorizing the mutation.
  void executeFrom(
    db,
    workflow,
    run,
    steps,
    event,
    run.currentStep + 1,
    results,
    user.id,
  ).catch((err: unknown) =>
    logger.error({ err, run: run.publicId }, "gate resume crashed"),
  );
  return true;
}

/**
 * Explicit gate rejection with an operator-supplied reason — the ❌
 * reaction path stays for quick rejections; this one feeds the
 * rejection-learning loop. Same approver rules as handleGateReaction.
 */
export async function rejectGateWithReason(
  db: Database,
  user: { id: string },
  target: GateTarget,
  reason: string,
): Promise<boolean> {
  const run = await resolveGateRun(db, target);
  if (!run) return false;
  const workflow = run.workflow;
  const steps = parseSteps(workflow.steps);
  const gateStep = steps?.[run.currentStep];
  if (!steps || gateStep?.type !== "gate") return false;

  const membership = await workspaceRepo.getMembership(
    db,
    user.id,
    run.workspaceId,
  );
  if (!membership) return false;
  if (gateStep.approvers === "admin" && membership.role !== "admin") return false;
  if (!roleHasPermission(membership.role, "agent:run")) return false;

  if (run.gateExpiresAt && run.gateExpiresAt < new Date()) {
    await expireGate(db, workflow, run);
    return true;
  }

  // Same double-fire guard as handleGateReaction: a concurrent reaction
  // or another rejectGateWithReason call may have already claimed this
  // gate's resolution.
  if (!(await claimGate(db, run))) return true;

  const trimmed = reason.trim().slice(0, 1000);
  const results = ((run.stepResults ?? []) as StepResult[]).map((r) =>
    r.step === run.currentStep
      ? { ...r, detail: `rejected by ${user.id}: ${trimmed}` }
      : r,
  );
  audit(db, {
    workspaceId: run.workspaceId,
    eventType: "workflow.gate.rejected",
    entityType: "workflow_run",
    entityPublicId: run.publicId,
    actorUserId: user.id,
    payload: { workflow: workflow.name, step: run.currentStep, reason: trimmed },
  });
  await workflowRepo.updateRun(db, run.id, {
    // Same distinct terminal status as the ❌-reaction path: not
    // "completed" (success) and not "failed" (system failure — would
    // fire workflow.run.failed and the sentinel loop).
    status: "rejected",
    stepResults: results,
    gateCommentPublicId: null,
    gateMessagePublicId: null,
    gateExpiresAt: null,
    gateClaim: null,
    error: trimmed ? `gate rejected: ${trimmed}` : "gate rejected",
    completedAt: new Date(),
  });
  dispatchWebhookEvent(db, run.workspaceId, "workflow.gate.rejected", {
    workflow: { publicId: workflow.publicId, name: workflow.name },
    run: { publicId: run.publicId },
    reason: trimmed,
  });
  return true;
}

/**
 * Implicit single-approver gate on @mention proposals: an agent reply
 * carries a `job:<id>` marker; a 👍 from anyone holding agent:run (plus
 * the per-action permissions checked inside applyJobActions) applies the
 * job's preset. Stateless — the marker in the comment is the gate.
 */
const JOB_MARKER_RE = /`job:([a-z0-9]{1,32})`/;

/** Structured outcome of a 👍-apply attempt — a bare boolean hid *why* an
 * apply silently no-op'd (stale job, cross-workspace, eval-blocked, …),
 * leaving the reactor with no feedback. `applied` stays false whenever no
 * apply was attempted at all (wrong emoji, no marker, no proposal) — only
 * set `reason` on paths where an apply was genuinely attempted. */
export interface ApplyProposalResult {
  applied: boolean;
  reason?: string;
}

const NOT_ATTEMPTED: ApplyProposalResult = { applied: false };

export async function tryApplyProposal(
  db: Database,
  user: { id: string },
  // Surface-independent proposal shape: a card comment or a channel
  // message — same marker, same approval semantics.
  proposal: { publicId: string; body: string; agentIdentityId: number | null },
  emoji: string,
  workspaceId: number,
  context: { cardPublicId?: string; boardPublicId?: string },
): Promise<ApplyProposalResult> {
  if (emoji !== "👍" || !proposal.agentIdentityId) return NOT_ATTEMPTED;
  const marker = JOB_MARKER_RE.exec(proposal.body);
  if (!marker) return NOT_ATTEMPTED;

  const membership = await workspaceRepo.getMembership(db, user.id, workspaceId);
  if (!membership || !roleHasPermission(membership.role, "agent:run")) {
    return NOT_ATTEMPTED;
  }

  const job = await getJob(marker[1]!);
  if (!job) {
    return { applied: false, reason: "job not found or stale" };
  }
  if (job.workspaceId !== workspaceId) {
    return { applied: false, reason: "job belongs to a different workspace" };
  }
  if (job.status !== "completed") {
    return { applied: false, reason: `job is ${job.status}, not completed` };
  }
  // Blocked proposals carry no `job:` marker; this is defence in depth
  // (e.g. an eval verdict recorded after the comment was posted).
  if (evalBlocksApply(job)) {
    return {
      applied: false,
      reason: `blocked by eval (status: ${job.evalStatus ?? "blocked"})`,
    };
  }

  let consumed = false;
  let failureReason: string | undefined;

  // Sandbox jobs: the 👍 applies the captured patch to the live folder.
  // applyJobPatch audits, posts the honest follow-up (applied / conflict)
  // and never force-applies — a conflict still consumes the approval.
  if (job.sandbox && job.patchTruncated) {
    failureReason = "patch truncated — apply manually";
  } else if (job.sandbox && job.patch && !job.patchTruncated && !job.patchAppliedAt) {
    try {
      // applyJobPatch reports clean refusals (conflict, folder lock) via
      // its return value, not by throwing — a false `applied` must reach
      // the caller as a failure reason, not read as success.
      const patchResult = await applyJobPatch(db, user.id, job);
      if (patchResult.applied) consumed = true;
      else failureReason = patchResult.detail;
    } catch (err) {
      failureReason = err instanceof Error ? err.message : "apply threw";
      logger.warn(
        { job: job.id, err: err instanceof Error ? err.message : err },
        "patch apply via reaction failed",
      );
    }
  }

  // Structured board actions (report comment, checklist ticks, …) apply
  // alongside the patch when present.
  if (
    !job.parseError &&
    job.resultParsed !== undefined &&
    !job.appliedActions?.length
  ) {
    const preset = buildApplyActions(job.schemaWorker ?? job.worker, job.resultParsed, {
      cardPublicId: context.cardPublicId,
      boardPublicId: context.boardPublicId,
      resultRaw: job.result,
    });
    if (preset && preset.actions.length > 0) {
      try {
        await applyJobActions(db, user.id, job, preset.actions, {
          enforceGrounding: true,
        });
        consumed = true;
      } catch (err) {
        failureReason = err instanceof Error ? err.message : "apply threw";
        logger.warn(
          { job: job.id, err: err instanceof Error ? err.message : err },
          "proposal apply via reaction failed",
        );
      }
    }
  }

  if (!consumed) {
    return { applied: false, reason: failureReason ?? "nothing applyable on this job" };
  }
  audit(db, {
    workspaceId,
    eventType: "agent.proposal.approved",
    entityType: "agent_job",
    entityPublicId: job.id,
    actorUserId: user.id,
    actorAgentId: proposal.agentIdentityId,
    payload: { worker: job.worker, via: proposal.publicId },
  });
  return { applied: true };
}

/* ── scheduler (in-process, single instance — same honesty as the
      runner: no serverless, no multi-instance) ─────────────────── */

/** Module-scoped flags don't survive dev hot-reloads — every recompile
 * of this module used to register a fresh interval, and a long dev
 * session accumulated dozens of stacked schedulers (observed as a burst
 * of simultaneous "scheduler tick failed" on wake-from-sleep). The
 * singleton lives on globalThis so a re-installed module clears its
 * predecessor's timer first. */
const globalForScheduler = globalThis as unknown as {
  kr8kanSchedulerTimer?: ReturnType<typeof setInterval>;
};
const TICK_MS = 60 * 60 * 1000;
/** Runs with no progress (updatedAt) for this long are dead. The longest
 * legitimate step is a runWorker wait (WORKER_WAIT_MS, 20 min), and the
 * engine bumps updatedAt on every step transition, so 1h of total
 * silence means the process died mid-step — not "still working". */
const REAP_AFTER_MS = 60 * 60 * 1000;

export function ensureScheduler(db: Database): void {
  if (globalForScheduler.kr8kanSchedulerTimer) return;
  void schedulerTick(db);
  const timer = setInterval(() => void schedulerTick(db), TICK_MS);
  globalForScheduler.kr8kanSchedulerTimer = timer;
  timer.unref?.();
}

export async function schedulerTick(db: Database): Promise<void> {
  try {
    const now = new Date();
    const enabled = await workflowRepo.listAllEnabled(db);

    for (const workflow of enabled) {
      const trigger = parseTrigger(workflow.trigger);
      if (!trigger) continue;

      if (trigger.type === "schedule") {
        let expr;
        try {
          expr = parseCron(trigger.cron);
        } catch {
          continue;
        }
        // Grace: catch up at most 1h of missed schedule after a restart.
        const since =
          workflow.lastFiredAt &&
          now.getTime() - workflow.lastFiredAt.getTime() < 2 * TICK_MS
            ? workflow.lastFiredAt
            : new Date(now.getTime() - TICK_MS);
        if (cronDueBetween(expr, since, now)) {
          await startRun(db, workflow, {
            type: "schedule",
            workspaceId: workflow.workspaceId,
            boardPublicId: workflow.boardPublicId ?? undefined,
          });
        }
      }

      if (trigger.type === "card.due") {
        const due = await cardRepo.listCardsDueWithin(db, {
          workspaceId: workflow.workspaceId,
          boardPublicId: workflow.boardPublicId ?? undefined,
          hours: trigger.beforeHours,
        });
        for (const card of due) {
          const already = await workflowRepo.hasRunForCardSince(
            db,
            workflow.id,
            card.publicId,
            new Date(now.getTime() - trigger.beforeHours * 3600_000),
          );
          if (already) continue;
          await startRun(db, workflow, {
            type: "card.due",
            workspaceId: workflow.workspaceId,
            boardPublicId: workflow.boardPublicId ?? undefined,
            cardPublicId: card.publicId,
          });
        }
      }
    }

    // Expire overdue gates (fails the run + tells the card).
    for (const run of await workflowRepo.listExpiredGates(db)) {
      await expireGate(db, run.workflow, run);
    }

    // Reap runs stranded in `running` — a crash mid-step leaves no other
    // recovery path. Keyed on updatedAt (last progress), not startedAt:
    // a run parked at a gate for hours then resumed still made progress.
    // Threshold: the longest legitimate step is 20 min (WORKER_WAIT_MS)
    // and the engine bumps updatedAt between steps, so 1h of NO progress
    // means dead.
    const staleBefore = new Date(now.getTime() - REAP_AFTER_MS);
    for (const run of await workflowRepo.listStaleRunningRuns(db, staleBefore)) {
      // Re-read through the same run+workflow shape failRun expects, and
      // re-check status — a run could have progressed (or finished)
      // between the listStaleRunningRuns scan and here.
      const fresh = await workflowRepo.getRunByPublicId(db, run.publicId);
      if (!fresh || fresh.status !== "running") continue;
      await failRun(
        db,
        fresh.workflow,
        fresh,
        (fresh.stepResults ?? []) as StepResult[],
        "reaped: no progress for 1h (last update older than REAP_AFTER_MS — likely a crash mid-step)",
      );
      logger.warn(
        { runPublicId: fresh.publicId, workflowId: fresh.workflowId },
        "reaped stale workflow run",
      );
    }
  } catch (err) {
    logger.error({ err }, "scheduler tick failed");
  }
}

/** Webhook trigger entry (REST route): fire a specific workflow by slug. */
export async function fireWebhookTrigger(
  db: Database,
  workspaceId: number,
  slug: string,
): Promise<WorkflowRunRow | null> {
  const enabled = await workflowRepo.listWorkflows(db, workspaceId, {
    enabledOnly: true,
  });
  for (const workflow of enabled) {
    const trigger = parseTrigger(workflow.trigger);
    if (trigger?.type === "webhook" && trigger.slug === slug) {
      return startRun(db, workflow, {
        type: "webhook",
        workspaceId,
        boardPublicId: workflow.boardPublicId ?? undefined,
      });
    }
  }
  return null;
}
