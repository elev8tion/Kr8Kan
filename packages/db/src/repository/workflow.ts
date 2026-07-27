import { generateUID } from "@kr8kan/shared";

import type { Database } from "../client";
import type { workflowRuns, workflows } from "../schema";

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
  return (await db.insert("workflows", {
    publicId: generateUID(),
    ...input,
  })) as WorkflowRow;
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
  return (await db.update("workflows", id, {
    ...patch,
    updatedAt: new Date(),
  })) as WorkflowRow | undefined;
}

export async function getWorkflowByPublicId(db: Database, publicId: string) {
  return (await db.findFirst("workflows", { where: { publicId } })) as
    | WorkflowRow
    | undefined;
}

export async function listWorkflows(
  db: Database,
  workspaceId: number,
  opts?: { enabledOnly?: boolean },
) {
  const where: Record<string, unknown> = { workspaceId };
  if (opts?.enabledOnly) where.enabled = true;
  return (await db.findMany("workflows", {
    where,
    orderBy: { field: "createdAt", dir: "desc" },
  })) as WorkflowRow[];
}

/** Every enabled workflow across the instance — the scheduler tick's
 * scan set (self-host scale; revisit if it ever grows teeth). */
export async function listAllEnabled(db: Database) {
  return (await db.findMany("workflows", {
    where: { enabled: true },
  })) as WorkflowRow[];
}

/* ── runs ──────────────────────────────────────────────────────── */

/** Batch join helper: workflows keyed by id (deleted included, matching
 * the old drizzle `with:` behavior). Fetched once — equality-only API. */
async function workflowMap(db: Database): Promise<Map<number, WorkflowRow>> {
  const rows = (await db.findMany("workflows", {
    includeDeleted: true,
  })) as WorkflowRow[];
  return new Map(rows.map((w) => [w.id, w]));
}

async function attachWorkflow(
  db: Database,
  run: WorkflowRunRow | undefined,
): Promise<(WorkflowRunRow & { workflow: WorkflowRow }) | undefined> {
  if (!run) return undefined;
  const workflow = (await db.findById("workflows", run.workflowId)) as
    | WorkflowRow
    | undefined;
  if (!workflow) return undefined;
  return { ...run, workflow };
}

export async function createRun(
  db: Database,
  input: {
    workflowId: number;
    workspaceId: number;
    triggerEvent?: unknown;
    cardPublicId?: string | null;
  },
) {
  return (await db.insert("workflowRuns", {
    publicId: generateUID(),
    ...input,
  })) as WorkflowRunRow;
}

export async function updateRun(
  db: Database,
  id: number,
  patch: Partial<{
    status: WorkflowRunRow["status"];
    stepResults: { step: number; type: string; ok: boolean; detail?: string }[];
    currentStep: number;
    gateCommentPublicId: string | null;
    gateMessagePublicId: string | null;
    gateExpiresAt: Date | null;
    error: string | null;
    completedAt: Date | null;
  }>,
) {
  return (await db.update("workflowRuns", id, patch)) as
    | WorkflowRunRow
    | undefined;
}

export async function getRunByPublicId(db: Database, publicId: string) {
  const run = (await db.findFirst("workflowRuns", { where: { publicId } })) as
    | WorkflowRunRow
    | undefined;
  return attachWorkflow(db, run);
}

export async function getRunByGateComment(db: Database, commentPublicId: string) {
  const run = (await db.findFirst("workflowRuns", {
    where: { gateCommentPublicId: commentPublicId, status: "waiting_gate" },
  })) as WorkflowRunRow | undefined;
  return attachWorkflow(db, run);
}

export async function getRunByGateMessage(db: Database, messagePublicId: string) {
  const run = (await db.findFirst("workflowRuns", {
    where: { gateMessagePublicId: messagePublicId, status: "waiting_gate" },
  })) as WorkflowRunRow | undefined;
  return attachWorkflow(db, run);
}

export async function listRuns(
  db: Database,
  workspaceId: number,
  filters?: { workflowId?: number; limit?: number },
) {
  const where: Record<string, unknown> = { workspaceId };
  if (filters?.workflowId) where.workflowId = filters.workflowId;
  const runs = (await db.findMany("workflowRuns", {
    where,
    orderBy: { field: "startedAt", dir: "desc" },
    limit: filters?.limit ?? 30,
  })) as WorkflowRunRow[];
  const byId = await workflowMap(db);
  return runs.map((run) => {
    const w = byId.get(run.workflowId);
    return {
      ...run,
      workflow: { name: w?.name ?? "", publicId: w?.publicId ?? "" },
    };
  });
}

export async function countRecentRuns(
  db: Database,
  workflowId: number,
  windowMs: number,
) {
  const since = new Date(Date.now() - windowMs);
  const rows = (await db.findMany("workflowRuns", {
    where: { workflowId },
  })) as WorkflowRunRow[];
  return rows.filter((r) => r.startedAt > since).length;
}

/** Live gates in a workspace, soonest expiry first (My-work surface). */
export async function listPendingGates(db: Database, workspaceId: number) {
  const runs = (await db.findMany("workflowRuns", {
    where: { workspaceId, status: "waiting_gate" },
    orderBy: { field: "gateExpiresAt" },
  })) as WorkflowRunRow[];
  const byId = await workflowMap(db);
  return runs.map((run) => ({
    ...run,
    workflow: byId.get(run.workflowId) as WorkflowRow,
  }));
}

/** Runs whose gate deadline has passed — failed out by the expiry sweep. */
export async function listExpiredGates(db: Database) {
  const now = new Date();
  const all = (await db.findMany("workflowRuns", {
    where: { status: "waiting_gate" },
  })) as WorkflowRunRow[];
  const runs = all.filter(
    (r) => r.gateExpiresAt !== null && r.gateExpiresAt < now,
  );
  const byId = await workflowMap(db);
  return runs.map((run) => ({
    ...run,
    workflow: byId.get(run.workflowId) as WorkflowRow,
  }));
}

/** Dedupe helper for card.due triggers: has this workflow already run
 * for this card since the given time? */
export async function hasRunForCardSince(
  db: Database,
  workflowId: number,
  cardPublicId: string,
  since: Date,
) {
  const rows = (await db.findMany("workflowRuns", {
    where: { workflowId, cardPublicId },
  })) as WorkflowRunRow[];
  return rows.some((r) => r.startedAt > since);
}
