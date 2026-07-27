import { createHash } from "node:crypto";

import type { Database } from "../client";
import type { auditLog } from "../schema";

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
 * Append one entry to the workspace's hash chain. NCB has no
 * transactions, so this is read-latest → hash → insert with a small
 * retry loop: the DB's UNIQUE(workspace_id, seq) key rejects the loser
 * of a race, and we re-read the tail and try again.
 */
export async function append(
  db: Database,
  entry: AuditEntryInput,
): Promise<AuditLogRow | undefined> {
  const MAX_ATTEMPTS = 3;
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const tail = (await db.findFirst("auditLog", {
      where: { workspaceId: entry.workspaceId },
      orderBy: { field: "seq", dir: "desc" },
      limit: 1,
    })) as AuditLogRow | undefined;
    const seq = (tail?.seq ?? 0) + 1;
    const prevHash = tail?.hash ?? GENESIS_HASH;
    // DATETIME storage is second-precision; truncate ms so the stored
    // createdAt round-trips identically and verifyChain recomputes true.
    const createdAt = new Date(Math.floor(Date.now() / 1000) * 1000);
    const hash = computeHash({
      prevHash,
      seq,
      eventType: entry.eventType,
      entityPublicId: entry.entityPublicId ?? null,
      payload: entry.payload,
      createdAt,
    });
    try {
      return (await db.insert("auditLog", {
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
      })) as AuditLogRow;
    } catch (err) {
      // Likely a racing writer took our seq (unique key). Re-read + retry.
      lastError = err;
    }
  }
  throw lastError;
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
  const where: Record<string, unknown> = { workspaceId };
  if (filters?.eventType) where.eventType = filters.eventType;
  if (filters?.entityPublicId) where.entityPublicId = filters.entityPublicId;
  if (filters?.actorUserId) where.actorUserId = filters.actorUserId;
  return (await db.findMany("auditLog", {
    where,
    orderBy: { field: "seq", dir: "desc" },
    limit: filters?.limit ?? 50,
  })) as AuditLogRow[];
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
  const all = (await db.findMany("auditLog", {
    where: { workspaceId },
    orderBy: { field: "seq" },
  })) as AuditLogRow[];
  const rows = all.filter((r) => r.seq >= fromSeq);
  let prevHash = GENESIS_HASH;
  if (fromSeq > 1) {
    const anchor = (await db.findFirst("auditLog", {
      where: { workspaceId, seq: fromSeq - 1 },
    })) as AuditLogRow | undefined;
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
