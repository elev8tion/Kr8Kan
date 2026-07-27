import { beforeAll, describe, expect, it } from "vitest";

import { generateUID } from "@kr8kan/shared";

import type { Database } from "../client";
import { createMemoryDb } from "../ncb/memory";
import * as auditLogRepo from "../repository/auditLog";

/** In-memory gateway with the production serialization round-trip — the
 * audit chain is only trustworthy if verify catches tampering against
 * rows stored exactly as NCB stores them. */
const memory = createMemoryDb();
const db = memory as unknown as Database;
let workspaceId: number;

beforeAll(async () => {
  const ws = await memory.insert("workspaces", {
    publicId: generateUID(),
    name: "Test",
    slug: "test",
  });
  workspaceId = ws.id as number;
});

describe("audit hash chain", () => {
  it("appends with monotonic seq and linked hashes", async () => {
    for (let i = 0; i < 5; i++) {
      await auditLogRepo.append(db, {
        workspaceId,
        eventType: "card.created",
        entityType: "card",
        entityPublicId: generateUID(),
        payload: { i },
      });
    }
    const rows = await auditLogRepo.list(db, workspaceId, { limit: 10 });
    expect(rows).toHaveLength(5);
    expect(rows[0]!.seq).toBe(5);
    // Each row's prevHash is its predecessor's hash.
    const ordered = [...rows].sort((a, b) => a.seq - b.seq);
    for (let i = 1; i < ordered.length; i++) {
      expect(ordered[i]!.prevHash).toBe(ordered[i - 1]!.hash);
    }
  });

  it("verifies an intact chain", async () => {
    const result = await auditLogRepo.verifyChain(db, workspaceId);
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(5);
  });

  it("detects payload tampering at the exact row", async () => {
    for (const row of memory.raw("audit_log").values()) {
      if (row.workspace_id === workspaceId && row.seq === 3) {
        row.payload = JSON.stringify({ i: 999 });
      }
    }
    const result = await auditLogRepo.verifyChain(db, workspaceId);
    expect(result.ok).toBe(false);
    expect(result.brokenAtSeq).toBe(3);
  });

  it("detects a deleted row (seq gap)", async () => {
    // restore payload first so only the gap breaks the chain
    for (const row of memory.raw("audit_log").values()) {
      if (row.workspace_id === workspaceId && row.seq === 3) {
        row.payload = JSON.stringify({ i: 2 });
      }
    }
    expect((await auditLogRepo.verifyChain(db, workspaceId)).ok).toBe(true);
    for (const [id, row] of memory.raw("audit_log")) {
      if (row.workspace_id === workspaceId && row.seq === 4) {
        memory.raw("audit_log").delete(id);
      }
    }
    const result = await auditLogRepo.verifyChain(db, workspaceId);
    expect(result.ok).toBe(false);
    expect(result.brokenAtSeq).toBe(4);
  });
});

describe("canonicalize", () => {
  it("is key-order independent", () => {
    expect(auditLogRepo.canonicalize({ b: 1, a: { d: 2, c: 3 } })).toBe(
      auditLogRepo.canonicalize({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });
});
