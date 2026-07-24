import { and, count, desc, eq, gt, inArray, lt, or, sql } from "drizzle-orm";

import type { Database } from "../client";
import { agentJobs } from "../schema";

export type AgentJobRow = typeof agentJobs.$inferSelect;

export async function createJob(
  db: Database,
  input: {
    publicId: string;
    workspaceId: number;
    boardPublicId?: string | null;
    cardPublicId?: string | null;
    worker: string;
    createdBy?: string | null;
    prompt?: string | null;
    projectPath?: string | null;
    piModel?: string | null;
    toolsUsed?: boolean;
    promptVersion?: number | null;
  },
) {
  const [row] = await db.insert(agentJobs).values(input).returning();
  return row;
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
    startedAt: Date | null;
    completedAt: Date | null;
  }>,
) {
  const [row] = await db
    .update(agentJobs)
    .set(patch)
    .where(eq(agentJobs.publicId, publicId))
    .returning();
  return row;
}

export async function getJobByPublicId(db: Database, publicId: string) {
  return db.query.agentJobs.findFirst({
    where: eq(agentJobs.publicId, publicId),
  });
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
  return db.query.agentJobs.findMany({
    where: and(
      eq(agentJobs.workspaceId, workspaceId),
      filters?.boardPublicId
        ? eq(agentJobs.boardPublicId, filters.boardPublicId)
        : undefined,
      filters?.worker ? eq(agentJobs.worker, filters.worker) : undefined,
      filters?.status ? eq(agentJobs.status, filters.status) : undefined,
    ),
    orderBy: desc(agentJobs.createdAt),
    limit: filters?.limit ?? 20,
  });
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
  const rows = await db
    .update(agentJobs)
    .set({
      status: "failed",
      error: "orphaned",
      completedAt: new Date(),
    })
    .where(
      or(
        and(eq(agentJobs.status, "running"), lt(agentJobs.startedAt, cutoff)),
        and(eq(agentJobs.status, "pending"), lt(agentJobs.createdAt, cutoff)),
      ),
    )
    .returning({ publicId: agentJobs.publicId });
  return rows.map((r) => r.publicId);
}

const ACTIVE = ["pending", "running"] as const;

export async function countActiveJobsForUser(db: Database, userId: string) {
  const [row] = await db
    .select({ value: count() })
    .from(agentJobs)
    .where(
      and(eq(agentJobs.createdBy, userId), inArray(agentJobs.status, [...ACTIVE])),
    );
  return row?.value ?? 0;
}

export async function countRecentJobsForUser(
  db: Database,
  userId: string,
  windowMs: number,
) {
  const [row] = await db
    .select({ value: count() })
    .from(agentJobs)
    .where(
      and(
        eq(agentJobs.createdBy, userId),
        gt(agentJobs.createdAt, new Date(Date.now() - windowMs)),
      ),
    );
  return row?.value ?? 0;
}

/** Project-folder lock: at most one live tools job per projectPath. */
export async function findActiveJobForProjectPath(
  db: Database,
  projectPath: string,
) {
  return db.query.agentJobs.findFirst({
    where: and(
      eq(agentJobs.projectPath, projectPath),
      inArray(agentJobs.status, [...ACTIVE]),
    ),
  });
}

/** Idempotent apply bookkeeping — merge new applied indices onto the row. */
export async function appendAppliedActions(
  db: Database,
  publicId: string,
  applied: { index: number; entityPublicId?: string; at: string }[],
) {
  await db
    .update(agentJobs)
    .set({
      appliedActions: sql`coalesce(${agentJobs.appliedActions}, '[]'::jsonb) || ${JSON.stringify(applied)}::jsonb`,
    })
    .where(eq(agentJobs.publicId, publicId));
}
