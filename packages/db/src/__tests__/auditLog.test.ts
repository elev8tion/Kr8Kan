import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";

import { generateUID } from "@kr8kan/shared";

import type { Database } from "../client";
import * as auditLogRepo from "../repository/auditLog";
import * as schema from "../schema";

/** In-memory PGlite with the real migrations — the audit chain is only
 * trustworthy if verify catches tampering against actual rows. */
let db: Database;
let workspaceId: number;

beforeAll(async () => {
  const pglite = new PGlite();
  db = drizzle(pglite, { schema }) as unknown as Database;
  await migrate(db as never, { migrationsFolder: "migrations" });
  const [ws] = await db
    .insert(schema.workspaces)
    .values({ publicId: generateUID(), name: "Test", slug: "test" })
    .returning();
  workspaceId = ws!.id;
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
    await db.execute(
      sql`UPDATE audit_log SET payload = '{"i": 999}'::jsonb WHERE workspace_id = ${workspaceId} AND seq = 3`,
    );
    const result = await auditLogRepo.verifyChain(db, workspaceId);
    expect(result.ok).toBe(false);
    expect(result.brokenAtSeq).toBe(3);
  });

  it("detects a deleted row (seq gap)", async () => {
    // restore payload first so only the gap breaks the chain
    await db.execute(
      sql`UPDATE audit_log SET payload = '{"i": 2}'::jsonb WHERE workspace_id = ${workspaceId} AND seq = 3`,
    );
    expect((await auditLogRepo.verifyChain(db, workspaceId)).ok).toBe(true);
    await db.execute(
      sql`DELETE FROM audit_log WHERE workspace_id = ${workspaceId} AND seq = 4`,
    );
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
