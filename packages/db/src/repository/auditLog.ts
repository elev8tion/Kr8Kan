import { createHash } from "node:crypto";

import { and, asc, desc, eq, gte } from "drizzle-orm";

import type { Database } from "../client";
import { auditLog } from "../schema";

export type AuditLogRow = typeof auditLog.$inferSelect;

const GENESIS_HASH = "0".repeat(64);

/** Deterministic JSON: object keys sorted recursively, arrays in order. */
export function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function computeHash(entry: {
  prevHash: string;
  seq: number;
  eventType: string;
  entityPublicId: string | null;
  payload: unknown;
  createdAt: Date;
}): string {
  return createHash("sha256")
    .update(
      [
        entry.prevHash,
        String(entry.seq),
        entry.eventType,
        entry.entityPublicId ?? "",
        canonicalize(entry.payload ?? null),
        entry.createdAt.toISOString(),
      ].join("|"),
    )
    .digest("hex");
}

export interface AuditEntryInput {
  workspaceId: number;
  eventType: string;
  entityType: string;
  entityPublicId?: string | null;
  actorUserId?: string | null;
  actorAgentId?: number | null;
  payload?: unknown;
}

/**
 * Append one entry to the workspace's hash chain. The tail row is read
 * inside the same transaction that inserts, so seq/prevHash stay
 * consistent; the unique (workspaceId, seq) index catches any race.
 */
export async function append(
  db: Database,
  entry: AuditEntryInput,
): Promise<AuditLogRow | undefined> {
  return db.transaction(async (tx) => {
    const tail = await tx.query.auditLog.findFirst({
      where: eq(auditLog.workspaceId, entry.workspaceId),
      orderBy: desc(auditLog.seq),
      columns: { seq: true, hash: true },
    });
    const seq = (tail?.seq ?? 0) + 1;
    const prevHash = tail?.hash ?? GENESIS_HASH;
    const createdAt = new Date();
    const hash = computeHash({
      prevHash,
      seq,
      eventType: entry.eventType,
      entityPublicId: entry.entityPublicId ?? null,
      payload: entry.payload,
      createdAt,
    });
    const [row] = await tx
      .insert(auditLog)
      .values({
        workspaceId: entry.workspaceId,
        seq,
        eventType: entry.eventType,
        entityType: entry.entityType,
        entityPublicId: entry.entityPublicId ?? null,
        actorUserId: entry.actorUserId ?? null,
        actorAgentId: entry.actorAgentId ?? null,
        payload: entry.payload ?? null,
        prevHash,
        hash,
        createdAt,
      })
      .returning();
    return row;
  });
}

export async function list(
  db: Database,
  workspaceId: number,
  filters?: {
    eventType?: string;
    entityPublicId?: string;
    actorUserId?: string;
    limit?: number;
    beforeSeq?: number;
  },
) {
  return db.query.auditLog.findMany({
    where: and(
      eq(auditLog.workspaceId, workspaceId),
      filters?.eventType ? eq(auditLog.eventType, filters.eventType) : undefined,
      filters?.entityPublicId
        ? eq(auditLog.entityPublicId, filters.entityPublicId)
        : undefined,
      filters?.actorUserId
        ? eq(auditLog.actorUserId, filters.actorUserId)
        : undefined,
    ),
    orderBy: desc(auditLog.seq),
    limit: filters?.limit ?? 50,
  });
}

/**
 * Recompute the chain from `fromSeq` (default 1). Returns ok, or the
 * first sequence whose stored hash no longer matches its content /
 * predecessor — i.e. exactly where tampering (or corruption) begins.
 */
export async function verifyChain(
  db: Database,
  workspaceId: number,
  fromSeq = 1,
): Promise<{ ok: boolean; checked: number; brokenAtSeq?: number }> {
  const rows = await db.query.auditLog.findMany({
    where: and(
      eq(auditLog.workspaceId, workspaceId),
      gte(auditLog.seq, fromSeq),
    ),
    orderBy: asc(auditLog.seq),
  });
  let prevHash = GENESIS_HASH;
  if (fromSeq > 1) {
    const anchor = await db.query.auditLog.findFirst({
      where: and(
        eq(auditLog.workspaceId, workspaceId),
        eq(auditLog.seq, fromSeq - 1),
      ),
      columns: { hash: true },
    });
    if (!anchor) return { ok: false, checked: 0, brokenAtSeq: fromSeq - 1 };
    prevHash = anchor.hash;
  }
  let expectedSeq = fromSeq;
  for (const row of rows) {
    if (row.seq !== expectedSeq) {
      return { ok: false, checked: expectedSeq - fromSeq, brokenAtSeq: expectedSeq };
    }
    const recomputed = computeHash({
      prevHash,
      seq: row.seq,
      eventType: row.eventType,
      entityPublicId: row.entityPublicId,
      payload: row.payload,
      createdAt: row.createdAt,
    });
    if (recomputed !== row.hash || row.prevHash !== prevHash) {
      return { ok: false, checked: row.seq - fromSeq, brokenAtSeq: row.seq };
    }
    prevHash = row.hash;
    expectedSeq += 1;
  }
  return { ok: true, checked: rows.length };
}
