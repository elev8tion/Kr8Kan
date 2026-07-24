import type { JobRecord } from "@kr8kan/agents";
import {
  buildApplyActions,
  checkGrounding,
  groundingReasons,
  judgeSchema,
  runWorker,
} from "@kr8kan/agents";
import type { Database } from "@kr8kan/db";
import {
  agentIdentityRepo,
  agentJobRepo,
  auditLogRepo,
  workspaceRepo,
} from "@kr8kan/db";
import { createLogger } from "@kr8kan/logger";

import { audit } from "./audit";

const logger = createLogger("eval-gate");

/**
 * Eval layer between "job completed" and "proposal becomes gate-able":
 *  1. deterministic grounding check — output ids must have been in the
 *     worker's context (no LLM, always on);
 *  2. optional judge worker (per-workspace opt-in) — scores the output
 *     pass/warn/fail; fail blocks the gated apply, warn annotates.
 *
 * Judge runs go through runWorker directly, NOT dispatchWorker — so they
 * never fire sentinel job.failed events (structural recursion guard: the
 * system-event sink only sees dispatchWorker jobs) and never post
 * proposals of their own.
 */

const JUDGE_WAIT_MS = 200_000;
const DIGEST_PROMPT_MAX = 1024;
const DIGEST_RESULT_MAX = 4096;
const DIGEST_EVENTS = 15;
const DIGEST_EVENT_DETAIL_MAX = 200;

export interface EvalGateOutcome {
  /** True → the proposal must NOT become gate-able (no `job:` marker). */
  blocked: boolean;
  /** Human-readable annotation for the proposal comment, if any. */
  annotation?: string;
}

export async function isJudgeEnabled(
  db: Database,
  workspaceId: number,
): Promise<boolean> {
  const workspace = await workspaceRepo.getWorkspaceById(db, workspaceId);
  return Boolean(workspace?.settings?.judgeEnabled);
}

const tail = (text: string, max: number) =>
  text.length > max ? `…${text.slice(-max)}` : text;

/** Bounded "Job under review" digest injected into the judge's prompt. */
export function buildJudgeDigest(job: JobRecord): string {
  const events = (job.events ?? [])
    .slice(-DIGEST_EVENTS)
    .map(
      (e) =>
        `- ${e.at} ${e.type}${e.detail ? `: ${e.detail.slice(0, DIGEST_EVENT_DETAIL_MAX)}` : ""}`,
    )
    .join("\n");
  return [
    `## Job under review`,
    `Worker: ${job.worker} (job \`${job.id}\`)`,
    job.prompt ? `### Request\n${tail(job.prompt, DIGEST_PROMPT_MAX)}` : null,
    job.result ? `### Output\n${tail(job.result, DIGEST_RESULT_MAX)}` : null,
    job.patchSummary ? `### Patch\n${job.patchSummary}` : null,
    events ? `### Event trace (tail)\n${events}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function recordEval(
  db: Database,
  job: JobRecord,
  evalStatus: NonNullable<JobRecord["evalStatus"]>,
  evalReasons: string[],
): Promise<void> {
  job.evalStatus = evalStatus;
  job.evalReasons = evalReasons;
  await agentJobRepo.updateJob(db, job.id, { evalStatus, evalReasons });
}

/**
 * Run the eval gate for a completed job that is about to post a
 * gate-able proposal. Fail-closed on real verdicts (grounding failure,
 * judge fail), fail-open with an annotation when the judge itself is
 * unavailable — an eval outage must not silently discard work, only a
 * verdict may block it.
 */
export async function runEvalGate(db: Database, job: JobRecord): Promise<EvalGateOutcome> {
  try {
    // 1. Grounding (deterministic, always on when we know the context).
    if (job.resultParsed !== undefined && !job.parseError && job.contextIds) {
      const preset = buildApplyActions(job.schemaWorker ?? job.worker, job.resultParsed, {
        cardPublicId: job.cardPublicId,
        boardPublicId: job.boardPublicId,
        resultRaw: job.result,
      });
      if (preset) {
        const grounding = checkGrounding(preset.actions, job.contextIds, [
          job.cardPublicId ?? "",
          job.boardPublicId ?? "",
        ]);
        if (!grounding.ok) {
          const reasons = groundingReasons(grounding);
          await recordEval(db, job, "grounding_failed", reasons);
          audit(db, {
            workspaceId: job.workspaceId!,
            eventType: "agent.eval.grounding_failed",
            entityType: "agent_job",
            entityPublicId: job.id,
            actorAgentId: job.agentIdentityId ?? null,
            payload: { worker: job.worker, reasons },
          });
          return {
            blocked: true,
            annotation: `🛑 **Grounding check failed** — the output references entities that were not in its context; apply is blocked.\n${reasons.map((r) => `- ${r}`).join("\n")}`,
          };
        }
      }
    }

    // 2. Judge (opt-in per workspace; only for outputs that would gate).
    const gateable =
      Boolean(job.patch && !job.patchTruncated) ||
      Boolean(job.resultParsed !== undefined && !job.parseError);
    if (!gateable || !job.workspaceId) return { blocked: false };
    if (!(await isJudgeEnabled(db, job.workspaceId))) return { blocked: false };

    const identity = await agentIdentityRepo.ensureIdentity(
      db,
      job.workspaceId,
      "judge",
    );
    let judgeJobId = "";
    const settled = await new Promise<JobRecord | null>((resolveSettled) => {
      const timer = setTimeout(() => resolveSettled(null), JUDGE_WAIT_MS);
      runWorker({
        worker: "judge",
        context: {},
        workspaceId: job.workspaceId,
        boardPublicId: job.boardPublicId,
        cardPublicId: job.cardPublicId,
        userId: job.createdBy,
        agentIdentityId: identity.id,
        extraContext: buildJudgeDigest(job),
        onFinish: async (settledJob) => {
          clearTimeout(timer);
          resolveSettled(settledJob);
        },
      }).then(
        (judgeJob) => {
          judgeJobId = judgeJob.id;
        },
        (err: unknown) => {
          clearTimeout(timer);
          logger.warn({ err }, "judge dispatch failed");
          resolveSettled(null);
        },
      );
    });
    const parsed =
      settled?.status === "completed" && !settled.parseError
        ? judgeSchema.safeParse(settled.resultParsed)
        : null;
    if (!parsed?.success) {
      // Judge unavailable/unparseable: fail-open with an honest note.
      return {
        blocked: false,
        annotation:
          "⚠️ Judge review was enabled but did not return a verdict — proceeding without it.",
      };
    }
    const { verdict, reasons } = parsed.data;
    const evalStatus =
      verdict === "fail"
        ? "judge_failed"
        : verdict === "warn"
          ? "judge_warn"
          : "judge_pass";
    await recordEval(db, job, evalStatus, reasons);
    audit(db, {
      workspaceId: job.workspaceId,
      eventType: `agent.eval.${evalStatus}`,
      entityType: "agent_job",
      entityPublicId: job.id,
      actorAgentId: identity.id,
      payload: { worker: job.worker, verdict, reasons, judgeJobId },
    });
    if (verdict === "fail") {
      return {
        blocked: true,
        annotation: `🛑 **Judge verdict: fail** — apply is blocked.\n${reasons.map((r) => `- ${r}`).join("\n")}`,
      };
    }
    if (verdict === "warn") {
      return {
        blocked: false,
        annotation: `⚠️ **Judge verdict: warn**\n${reasons.map((r) => `- ${r}`).join("\n")}`,
      };
    }
    return { blocked: false };
  } catch (err) {
    // The eval layer must never eat a finished job.
    logger.warn({ job: job.id, err }, "eval gate errored — failing open");
    return {
      blocked: false,
      annotation: "⚠️ Eval checks errored — proceeding without a verdict.",
    };
  }
}

/** Pure gate decision for the apply path — exported for tests. */
export function evalBlocksApply(job: Pick<JobRecord, "evalStatus">): boolean {
  return job.evalStatus === "grounding_failed" || job.evalStatus === "judge_failed";
}

const SIGNALS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const SIGNALS_LIMIT = 20;

/**
 * "Recent eval signals" digest injected into eval-reviewer runs: rejection
 * reasons humans attached at gates plus judge fail verdicts. This is the
 * rejection-learning loop's raw material — the reviewer proposes new
 * heuristics from it, through a gate, never self-applying.
 */
export async function buildEvalSignalsDigest(
  db: Database,
  workspaceId: number,
): Promise<string> {
  const [rejections, judgeFails] = await Promise.all([
    auditLogRepo.list(db, workspaceId, {
      eventType: "workflow.gate.rejected",
      limit: SIGNALS_LIMIT,
    }),
    agentJobRepo.listRecentJobsWithEvalStatus(
      db,
      workspaceId,
      "judge_failed",
      SIGNALS_WINDOW_MS,
      SIGNALS_LIMIT,
    ),
  ]);
  const rejectionLines = rejections
    .map((r) => {
      const payload = (r.payload ?? {}) as { workflow?: string; reason?: string };
      return `- [${r.createdAt.toISOString()}] workflow "${payload.workflow ?? "?"}"${payload.reason ? `: ${payload.reason.slice(0, 300)}` : " (no reason given)"}`;
    })
    .join("\n");
  const judgeLines = judgeFails
    .map(
      (j) =>
        `- [${j.createdAt.toISOString()}] worker ${j.worker} (job \`${j.publicId}\`): ${(j.evalReasons ?? []).join("; ").slice(0, 300)}`,
    )
    .join("\n");
  return [
    "## Recent eval signals",
    `### Gate rejections (last ${SIGNALS_LIMIT})`,
    rejectionLines || "(none)",
    "### Judge failures (last 30 days)",
    judgeLines || "(none)",
  ].join("\n\n");
}
