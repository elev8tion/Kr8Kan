import type { Database } from "../client";
import type { agentJobs } from "../schema";

export type AgentJobRow = typeof agentJobs.$inferSelect;

export async function createJob(
  db: Database,
  input: {
    publicId: string;
    workspaceId: number;
    boardPublicId?: string | null;
    cardPublicId?: string | null;
    worker: string;
    schemaWorker?: string | null;
    agentIdentityId?: number | null;
    sourceCommentPublicId?: string | null;
    createdBy?: string | null;
    prompt?: string | null;
    projectPath?: string | null;
    piModel?: string | null;
    toolsUsed?: boolean;
    promptVersion?: number | null;
    retryOfPublicId?: string | null;
    sandbox?: boolean;
    contextIds?: string[] | null;
    promptFlags?: string[] | null;
  },
) {
  return (await db.insert("agentJobs", input)) as AgentJobRow;
}

export async function updateJob(
  db: Database,
  publicId: string,
  patch: Partial<{
    status: AgentJobRow["status"];
    resultRaw: string | null;
    resultParsed: unknown;
    parseError: string | null;
    error: string | null;
    progress: string | null;
    verifyStatus: string | null;
    verifyLog: string | null;
    appliedActions: { index: number; entityPublicId?: string; at: string }[];
    events: { at: string; type: string; detail?: string }[];
    patch: string | null;
    patchSummary: string | null;
    patchTruncated: boolean;
    patchAppliedAt: Date | null;
    patchApplyError: string | null;
    evalStatus: string | null;
    evalReasons: string[] | null;
    startedAt: Date | null;
    completedAt: Date | null;
  }>,
) {
  const rows = (await db.updateWhere(
    "agentJobs",
    { publicId },
    patch,
  )) as AgentJobRow[];
  return rows[0];
}

export async function getJobByPublicId(db: Database, publicId: string) {
  return (await db.findFirst("agentJobs", { where: { publicId } })) as
    | AgentJobRow
    | undefined;
}

export async function listJobsForWorkspace(
  db: Database,
  workspaceId: number,
  filters?: {
    boardPublicId?: string;
    worker?: string;
    status?: AgentJobRow["status"];
    limit?: number;
  },
) {
  const where: Record<string, unknown> = { workspaceId };
  if (filters?.boardPublicId) where.boardPublicId = filters.boardPublicId;
  if (filters?.worker) where.worker = filters.worker;
  if (filters?.status) where.status = filters.status;
  // agentJobs has no soft-delete column (see ncb/tables.ts) and `where`
  // is equality-only above, so serverLimit is safe to combine directly.
  return (await db.findMany("agentJobs", {
    where,
    orderBy: { field: "createdAt", dir: "desc" },
    serverLimit: filters?.limit ?? 20,
  })) as AgentJobRow[];
}

/**
 * Crash recovery: jobs stuck `running` past their timeout budget (their
 * process died with the server) get failed out; stale `pending` rows from
 * a dead in-process queue are failed too. Returns affected publicIds.
 */
export async function markOrphans(
  db: Database,
  olderThanMs: number,
): Promise<string[]> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const running = (await db.findMany("agentJobs", {
    where: { status: "running" },
  })) as AgentJobRow[];
  const pending = (await db.findMany("agentJobs", {
    where: { status: "pending" },
  })) as AgentJobRow[];
  const orphans = [
    ...running.filter((r) => r.startedAt !== null && r.startedAt < cutoff),
    ...pending.filter((r) => r.createdAt < cutoff),
  ];
  const publicIds: string[] = [];
  for (const row of orphans) {
    await db.update("agentJobs", row.id, {
      status: "failed",
      error: "orphaned",
      completedAt: new Date(),
    });
    publicIds.push(row.publicId);
  }
  return publicIds;
}

const ACTIVE = ["pending", "running"] as const;

// dispatchWorker.ts (READ-ONLY, other package) compares these counts
// against small per-user caps — maxActivePerUser() defaults to 3,
// maxRunsPerHour() defaults to 30, both env-overridable
// (KR8KAN_PI_MAX_PER_USER / KR8KAN_PI_MAX_PER_HOUR). Active/recent jobs
// are, by construction, near the front of a user's history, so capping
// the fetch to the most recent JOB_COUNT_FETCH_CAP (well above any
// plausible cap) instead of the user's full job history is safe without
// needing the exact threshold passed down (these functions' signatures
// stay unchanged).
const JOB_COUNT_FETCH_CAP = 1000;

export async function countActiveJobsForUser(db: Database, userId: string) {
  const rows = (await db.findMany("agentJobs", {
    where: { createdBy: userId },
    orderBy: { field: "createdAt", dir: "desc" },
    serverLimit: JOB_COUNT_FETCH_CAP,
  })) as AgentJobRow[];
  return rows.filter((r) => (ACTIVE as readonly string[]).includes(r.status))
    .length;
}

export async function countRecentJobsForUser(
  db: Database,
  userId: string,
  windowMs: number,
) {
  const since = new Date(Date.now() - windowMs);
  const rows = (await db.findMany("agentJobs", {
    where: { createdBy: userId },
    orderBy: { field: "createdAt", dir: "desc" },
    serverLimit: JOB_COUNT_FETCH_CAP,
  })) as AgentJobRow[];
  return rows.filter((r) => r.createdAt > since).length;
}

/** A user's recently finished jobs (notification feed source). */
export async function listRecentFinishedJobsForUser(
  db: Database,
  workspaceId: number,
  userId: string,
  limit = 20,
) {
  // Over-fetch past `limit` (server page, then client status filter +
  // slice) so in-flight jobs interleaved among the most recent don't
  // starve the finished-jobs page.
  const rows = (await db.findMany("agentJobs", {
    where: { workspaceId, createdBy: userId },
    orderBy: { field: "completedAt", dir: "desc" },
    serverLimit: Math.max(limit * 5, 100),
  })) as AgentJobRow[];
  return rows
    .filter((r) => r.status === "completed" || r.status === "failed")
    .slice(0, limit);
}

/** Project-folder lock: at most one live (non-sandboxed) tools job per
 * projectPath. Sandboxed runs work in their own worktree and don't
 * contend for the live tree — only live edits and patch applies do. */
export async function findActiveJobForProjectPath(
  db: Database,
  projectPath: string,
) {
  const rows = (await db.findMany("agentJobs", {
    where: { projectPath, sandbox: false },
  })) as AgentJobRow[];
  return rows.find((r) => (ACTIVE as readonly string[]).includes(r.status));
}

/** Recent jobs carrying an eval verdict (eval-reviewer digest source). */
export async function listRecentJobsWithEvalStatus(
  db: Database,
  workspaceId: number,
  evalStatus: string,
  windowMs: number,
  limit = 20,
) {
  const since = new Date(Date.now() - windowMs);
  const rows = (await db.findMany("agentJobs", {
    where: { workspaceId, evalStatus },
    orderBy: { field: "createdAt", dir: "desc" },
  })) as AgentJobRow[];
  return rows.filter((r) => r.createdAt > since).slice(0, limit);
}

/** Idempotent apply bookkeeping — merge new applied indices onto the row. */
export async function appendAppliedActions(
  db: Database,
  publicId: string,
  applied: { index: number; entityPublicId?: string; at: string }[],
) {
  const row = (await db.findFirst("agentJobs", { where: { publicId } })) as
    | AgentJobRow
    | undefined;
  if (!row) return;
  const existing = row.appliedActions ?? [];
  await db.update("agentJobs", row.id, {
    appliedActions: [...existing, ...applied],
  });
}
