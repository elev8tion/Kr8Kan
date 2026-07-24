import { and, count, desc, eq, gt, isNull, lt } from "drizzle-orm";

import { generateUID } from "@kr8kan/shared";

import type { Database } from "../client";
import { workflowRuns, workflows } from "../schema";

export type WorkflowRow = typeof workflows.$inferSelect;
export type WorkflowRunRow = typeof workflowRuns.$inferSelect;

export async function createWorkflow(
  db: Database,
  input: {
    workspaceId: number;
    boardPublicId?: string | null;
    name: string;
    trigger: unknown;
    steps: unknown;
    enabled?: boolean;
    createdBy: string;
  },
) {
  const [row] = await db
    .insert(workflows)
    .values({ publicId: generateUID(), ...input })
    .returning();
  return row;
}

export async function updateWorkflow(
  db: Database,
  id: number,
  patch: Partial<{
    name: string;
    enabled: boolean;
    trigger: unknown;
    steps: unknown;
    boardPublicId: string | null;
    lastFiredAt: Date;
    deletedAt: Date;
  }>,
) {
  const [row] = await db
    .update(workflows)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(workflows.id, id))
    .returning();
  return row;
}

export async function getWorkflowByPublicId(db: Database, publicId: string) {
  return db.query.workflows.findFirst({
    where: and(eq(workflows.publicId, publicId), isNull(workflows.deletedAt)),
  });
}

export async function listWorkflows(
  db: Database,
  workspaceId: number,
  opts?: { enabledOnly?: boolean },
) {
  return db.query.workflows.findMany({
    where: and(
      eq(workflows.workspaceId, workspaceId),
      isNull(workflows.deletedAt),
      opts?.enabledOnly ? eq(workflows.enabled, true) : undefined,
    ),
    orderBy: desc(workflows.createdAt),
  });
}

/** Every enabled workflow across the instance — the scheduler tick's
 * scan set (self-host scale; revisit if it ever grows teeth). */
export async function listAllEnabled(db: Database) {
  return db.query.workflows.findMany({
    where: and(eq(workflows.enabled, true), isNull(workflows.deletedAt)),
  });
}

/* ── runs ──────────────────────────────────────────────────────── */

export async function createRun(
  db: Database,
  input: {
    workflowId: number;
    workspaceId: number;
    triggerEvent?: unknown;
    cardPublicId?: string | null;
  },
) {
  const [row] = await db
    .insert(workflowRuns)
    .values({ publicId: generateUID(), ...input })
    .returning();
  return row;
}

export async function updateRun(
  db: Database,
  id: number,
  patch: Partial<{
    status: WorkflowRunRow["status"];
    stepResults: { step: number; type: string; ok: boolean; detail?: string }[];
    currentStep: number;
    gateCommentPublicId: string | null;
    gateExpiresAt: Date | null;
    error: string | null;
    completedAt: Date | null;
  }>,
) {
  const [row] = await db
    .update(workflowRuns)
    .set(patch)
    .where(eq(workflowRuns.id, id))
    .returning();
  return row;
}

export async function getRunByPublicId(db: Database, publicId: string) {
  return db.query.workflowRuns.findFirst({
    where: eq(workflowRuns.publicId, publicId),
    with: { workflow: true },
  });
}

export async function getRunByGateComment(db: Database, commentPublicId: string) {
  return db.query.workflowRuns.findFirst({
    where: and(
      eq(workflowRuns.gateCommentPublicId, commentPublicId),
      eq(workflowRuns.status, "waiting_gate"),
    ),
    with: { workflow: true },
  });
}

export async function listRuns(
  db: Database,
  workspaceId: number,
  filters?: { workflowId?: number; limit?: number },
) {
  return db.query.workflowRuns.findMany({
    where: and(
      eq(workflowRuns.workspaceId, workspaceId),
      filters?.workflowId
        ? eq(workflowRuns.workflowId, filters.workflowId)
        : undefined,
    ),
    orderBy: desc(workflowRuns.startedAt),
    limit: filters?.limit ?? 30,
    with: { workflow: { columns: { name: true, publicId: true } } },
  });
}

export async function countRecentRuns(
  db: Database,
  workflowId: number,
  windowMs: number,
) {
  const [row] = await db
    .select({ value: count() })
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.workflowId, workflowId),
        gt(workflowRuns.startedAt, new Date(Date.now() - windowMs)),
      ),
    );
  return row?.value ?? 0;
}

/** Runs whose gate deadline has passed — failed out by the expiry sweep. */
export async function listExpiredGates(db: Database) {
  return db.query.workflowRuns.findMany({
    where: and(
      eq(workflowRuns.status, "waiting_gate"),
      lt(workflowRuns.gateExpiresAt, new Date()),
    ),
    with: { workflow: true },
  });
}

/** Dedupe helper for card.due triggers: has this workflow already run
 * for this card since the given time? */
export async function hasRunForCardSince(
  db: Database,
  workflowId: number,
  cardPublicId: string,
  since: Date,
) {
  const row = await db.query.workflowRuns.findFirst({
    where: and(
      eq(workflowRuns.workflowId, workflowId),
      eq(workflowRuns.cardPublicId, cardPublicId),
      gt(workflowRuns.startedAt, since),
    ),
    columns: { id: true },
  });
  return Boolean(row);
}
