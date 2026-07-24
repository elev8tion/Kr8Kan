import type { JobRecord, JobStore } from "@kr8kan/agents";
import { setJobStore } from "@kr8kan/agents";
import type { AgentJobRow, Database } from "@kr8kan/db";
import { agentJobRepo } from "@kr8kan/db";
import { createLogger } from "@kr8kan/logger";

const logger = createLogger("agent-store");

export function rowToJobRecord(row: AgentJobRow): JobRecord {
  return {
    id: row.publicId,
    worker: row.worker,
    status: row.status,
    schemaWorker: row.schemaWorker ?? undefined,
    agentIdentityId: row.agentIdentityId ?? undefined,
    sourceCommentPublicId: row.sourceCommentPublicId ?? undefined,
    prompt: row.prompt ?? undefined,
    workspaceId: row.workspaceId,
    boardPublicId: row.boardPublicId ?? undefined,
    cardPublicId: row.cardPublicId ?? undefined,
    createdBy: row.createdBy ?? undefined,
    result: row.resultRaw ?? undefined,
    resultParsed: row.resultParsed ?? undefined,
    parseError: row.parseError ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString(),
    completedAt: row.completedAt?.toISOString(),
    projectPath: row.projectPath ?? undefined,
    piModel: row.piModel ?? undefined,
    toolsUsed: row.toolsUsed,
    promptVersion: row.promptVersion ?? undefined,
    progress: row.progress ?? undefined,
    verifyStatus: (row.verifyStatus as JobRecord["verifyStatus"]) ?? undefined,
    verifyLog: row.verifyLog ?? undefined,
    appliedActions: row.appliedActions ?? undefined,
    events: row.events ?? undefined,
    retryOf: row.retryOfPublicId ?? undefined,
    sandbox: row.sandbox,
    patch: row.patch ?? undefined,
    patchSummary: row.patchSummary ?? undefined,
    patchTruncated: row.patchTruncated,
    patchAppliedAt: row.patchAppliedAt?.toISOString(),
    patchApplyError: row.patchApplyError ?? undefined,
  };
}

function dbJobStore(db: Database): JobStore {
  return {
    async create(job) {
      if (job.workspaceId === undefined) {
        throw new Error("db job store requires workspaceId on every job");
      }
      await agentJobRepo.createJob(db, {
        publicId: job.id,
        workspaceId: job.workspaceId,
        boardPublicId: job.boardPublicId ?? null,
        cardPublicId: job.cardPublicId ?? null,
        worker: job.worker,
        schemaWorker: job.schemaWorker ?? null,
        agentIdentityId: job.agentIdentityId ?? null,
        sourceCommentPublicId: job.sourceCommentPublicId ?? null,
        createdBy: job.createdBy ?? null,
        prompt: job.prompt ?? null,
        projectPath: job.projectPath ?? null,
        piModel: job.piModel ?? null,
        toolsUsed: job.toolsUsed ?? false,
        promptVersion: job.promptVersion ?? null,
        retryOfPublicId: job.retryOf ?? null,
        sandbox: job.sandbox ?? false,
      });
    },
    async update(id, patch) {
      const mapped: Parameters<typeof agentJobRepo.updateJob>[2] = {};
      if ("status" in patch && patch.status) mapped.status = patch.status;
      if ("result" in patch) mapped.resultRaw = patch.result ?? null;
      if ("resultParsed" in patch) mapped.resultParsed = patch.resultParsed;
      if ("parseError" in patch) mapped.parseError = patch.parseError ?? null;
      if ("error" in patch) mapped.error = patch.error ?? null;
      if ("progress" in patch) mapped.progress = patch.progress ?? null;
      if ("verifyStatus" in patch) mapped.verifyStatus = patch.verifyStatus ?? null;
      if ("verifyLog" in patch) mapped.verifyLog = patch.verifyLog ?? null;
      if ("appliedActions" in patch)
        mapped.appliedActions = patch.appliedActions ?? [];
      if ("events" in patch) mapped.events = patch.events ?? [];
      if ("patch" in patch) mapped.patch = patch.patch ?? null;
      if ("patchSummary" in patch) mapped.patchSummary = patch.patchSummary ?? null;
      if ("patchTruncated" in patch)
        mapped.patchTruncated = patch.patchTruncated ?? false;
      if ("patchAppliedAt" in patch)
        mapped.patchAppliedAt = patch.patchAppliedAt
          ? new Date(patch.patchAppliedAt)
          : null;
      if ("patchApplyError" in patch)
        mapped.patchApplyError = patch.patchApplyError ?? null;
      if ("startedAt" in patch)
        mapped.startedAt = patch.startedAt ? new Date(patch.startedAt) : null;
      if ("completedAt" in patch)
        mapped.completedAt = patch.completedAt ? new Date(patch.completedAt) : null;
      await agentJobRepo.updateJob(db, id, mapped);
    },
    async get(id) {
      if (!/^[a-z0-9]{1,32}$/i.test(id)) return null;
      const row = await agentJobRepo.getJobByPublicId(db, id);
      return row ? rowToJobRecord(row) : null;
    },
    async list(filters) {
      if (!filters?.workspaceId) return [];
      const rows = await agentJobRepo.listJobsForWorkspace(
        db,
        filters.workspaceId,
        {
          boardPublicId: filters.boardPublicId,
          worker: filters.worker,
          status: filters.status,
          limit: filters.limit,
        },
      );
      return rows.map(rowToJobRecord);
    },
  };
}

/** Anything `running` longer than the tools budget (default 15 min) plus
 * slack is a corpse from a previous process. */
const ORPHAN_AFTER_MS = 20 * 60 * 1000;

let installed = false;

/**
 * Idempotent boot hook: installs the DB-backed job store into the runner
 * and fails out jobs orphaned by a previous process. Called on first
 * touch of the agent router.
 */
export function ensureAgentInfra(db: Database): void {
  if (installed) return;
  installed = true;
  setJobStore(dbJobStore(db));
  // Workflow scheduler rides the same boot hook (lazy import breaks the
  // module cycle agentStore ↔ workflowEngine).
  void import("./workflowEngine").then(({ ensureScheduler }) =>
    ensureScheduler(db),
  );
  void agentJobRepo
    .markOrphans(db, ORPHAN_AFTER_MS)
    .then((ids) => {
      if (ids.length) {
        logger.warn({ jobs: ids }, "failed orphaned agent jobs from previous run");
      }
    })
    .catch((err: unknown) => {
      logger.error({ err }, "agent job reaper failed");
    });
}
