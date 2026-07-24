import type { JobRecord } from "@kr8kan/agents";
import { getJob } from "@kr8kan/agents";
import { buildApplyActions } from "@kr8kan/agents/apply";
import type { Database, WorkflowRow, WorkflowRunRow } from "@kr8kan/db";
import {
  agentIdentityRepo,
  cardRepo,
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
  interpolate,
  matchesTrigger,
  parseCron,
  roleHasPermission,
  workflowStepsSchema,
  workflowTriggerSchema,
} from "@kr8kan/shared";

import { applyJobActions } from "./agentApply";
import { audit } from "./audit";
import { dispatchWorker, waitForJob } from "./dispatchWorker";
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
      const trigger = parseTrigger(workflow.trigger);
      if (!trigger || !matchesTrigger(trigger, event)) continue;
      await startRun(db, workflow, event);
    }
  })().catch((err: unknown) => {
    logger.error({ err, type: event.type }, "trigger fan-out failed");
  });
}

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
): Promise<Record<string, unknown>> {
  let card: Record<string, unknown> | undefined;
  if (event.cardPublicId) {
    const row = await cardRepo.getCardWithBoard(db, event.cardPublicId);
    if (row) card = { publicId: row.publicId, title: row.title, list: row.list.name };
  }
  const steps: Record<string, unknown>[] = [];
  for (const r of results) {
    let result: unknown;
    if (r.jobId) {
      const job = await getJob(r.jobId);
      result = job?.resultParsed ?? job?.result;
    }
    steps.push({ ok: r.ok, detail: r.detail, result });
  }
  return {
    card,
    board: { publicId: event.boardPublicId },
    trigger: event,
    steps,
    workflow: { name: workflow.name },
  };
}

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
    const scope = await loadScope(db, event, workflow, results);

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
          });
        } catch (err) {
          await fail(i, step.type, err instanceof Error ? err.message : "dispatch failed");
          return;
        }
        const finished = await waitForJob(job.id, WORKER_WAIT_MS);
        if (!finished || finished.status !== "completed") {
          await fail(
            i,
            step.type,
            `job ${job.id} ${finished?.status ?? "timed out"}: ${finished?.error ?? ""}`,
          );
          return;
        }
        results.push({ step: i, type: step.type, ok: true, jobId: finished.id });
        break;
      }

      case "gate": {
        if (!event.cardPublicId) {
          await fail(i, step.type, "gate requires a card-scoped run");
          return;
        }
        const card = await cardRepo.getCardWithBoard(db, event.cardPublicId);
        if (!card) {
          await fail(i, step.type, "card vanished before gate");
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
        const comment = await cardRepo.addComment(db, {
          cardId: card.id,
          comment: body,
          userId: operator,
          agentIdentityId: identity.id,
        });
        results.push({ step: i, type: step.type, ok: true, detail: "waiting" });
        await workflowRepo.updateRun(db, run.id, {
          status: "waiting_gate",
          currentStep: i,
          stepResults: results,
          gateCommentPublicId: comment?.publicId ?? null,
          gateExpiresAt: new Date(Date.now() + step.timeoutHours * 3600_000),
        });
        audit(db, {
          workspaceId: workflow.workspaceId,
          eventType: "workflow.gate.opened",
          entityType: "workflow_run",
          entityPublicId: run.publicId,
          actorAgentId: identity.id,
          payload: { workflow: workflow.name, step: i, emoji: step.emoji },
        });
        dispatchWebhookEvent(db, workflow.workspaceId, "workflow.gate.pending", {
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
        const job = await getJob(lastWorker.jobId);
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
          const applied = await applyJobActions(db, operator, job, preset.actions);
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
          comment: interpolate(step.bodyTemplate, scope),
          userId: operator,
          agentIdentityId: identity.id,
        });
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
  logger.warn({ run: run.publicId, error }, "workflow run failed");
}

/* ── gate resolution (called from the reaction mutation) ─────────── */

/**
 * If this reaction targets a live gate comment, resolve it. Approver
 * permissions are re-checked NOW (not at gate creation): the reactor
 * must satisfy the gate's approver spec, and the gated apply re-checks
 * per-action permissions against the approver inside applyJobActions.
 * Returns true when the reaction was consumed by a gate.
 */
export async function handleGateReaction(
  db: Database,
  user: { id: string },
  commentPublicId: string,
  emoji: string,
): Promise<boolean> {
  const run = await workflowRepo.getRunByGateComment(db, commentPublicId);
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
    await failRun(db, workflow, run, (run.stepResults ?? []) as StepResult[], "gate expired");
    return true;
  }

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
      status: "completed",
      stepResults: results,
      gateCommentPublicId: null,
      gateExpiresAt: null,
      error: "gate rejected",
      completedAt: new Date(),
    });
    return true;
  }

  await workflowRepo.updateRun(db, run.id, {
    status: "running",
    stepResults: results,
    gateCommentPublicId: null,
    gateExpiresAt: null,
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
 * Implicit single-approver gate on @mention proposals: an agent reply
 * carries a `job:<id>` marker; a 👍 from anyone holding agent:run (plus
 * the per-action permissions checked inside applyJobActions) applies the
 * job's preset. Stateless — the marker in the comment is the gate.
 */
const JOB_MARKER_RE = /`job:([a-z0-9]{1,32})`/;

export async function tryApplyProposal(
  db: Database,
  user: { id: string },
  comment: { publicId: string; comment: string; agentIdentityId: number | null },
  emoji: string,
  workspaceId: number,
  context: { cardPublicId?: string; boardPublicId?: string },
): Promise<boolean> {
  if (emoji !== "👍" || !comment.agentIdentityId) return false;
  const marker = JOB_MARKER_RE.exec(comment.comment);
  if (!marker) return false;

  const membership = await workspaceRepo.getMembership(db, user.id, workspaceId);
  if (!membership || !roleHasPermission(membership.role, "agent:run")) {
    return false;
  }

  const job = await getJob(marker[1]!);
  if (!job || job.workspaceId !== workspaceId || job.status !== "completed") {
    return false;
  }
  if (job.parseError || job.resultParsed === undefined) return false;
  if (job.appliedActions?.length) return false; // already applied — no-op

  const preset = buildApplyActions(job.schemaWorker ?? job.worker, job.resultParsed, {
    cardPublicId: context.cardPublicId,
    boardPublicId: context.boardPublicId,
    resultRaw: job.result,
  });
  if (!preset || preset.actions.length === 0) return false;

  try {
    await applyJobActions(db, user.id, job, preset.actions);
  } catch (err) {
    logger.warn(
      { job: job.id, err: err instanceof Error ? err.message : err },
      "proposal apply via reaction failed",
    );
    return false;
  }
  audit(db, {
    workspaceId,
    eventType: "agent.proposal.approved",
    entityType: "agent_job",
    entityPublicId: job.id,
    actorUserId: user.id,
    actorAgentId: comment.agentIdentityId,
    payload: { worker: job.worker, viaComment: comment.publicId },
  });
  return true;
}

/* ── scheduler (in-process, single instance — same honesty as the
      runner: no serverless, no multi-instance) ─────────────────── */

let schedulerInstalled = false;
const TICK_MS = 60 * 60 * 1000;

export function ensureScheduler(db: Database): void {
  if (schedulerInstalled) return;
  schedulerInstalled = true;
  void schedulerTick(db);
  const timer = setInterval(() => void schedulerTick(db), TICK_MS);
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

    // Expire overdue gates.
    for (const run of await workflowRepo.listExpiredGates(db)) {
      await failRun(
        db,
        run.workflow,
        run,
        (run.stepResults ?? []) as StepResult[],
        "gate expired",
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
