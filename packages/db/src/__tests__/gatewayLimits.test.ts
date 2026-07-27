import { describe, expect, it } from "vitest";

import { generateUID } from "@kr8kan/shared";

import { createMemoryDb } from "../ncb/memory";

/**
 * MemoryGateway semantics that repos rely on: insertIfAbsent conflict
 * handling, updateWhere's default includeDeleted:true, findMany's
 * onlyDeleted/includeDeleted/default-excludes-deleted behavior, the
 * orderBy+limit interaction, and unique-key rejection on duplicate
 * insert. `serverLimit` is an NcbGateway-only concept (server-side
 * paging) — MemoryGateway.findMany has no such parameter, so it is not
 * exercised here; only the client-side `limit` path is tested.
 */

describe("insertIfAbsent", () => {
  it("creates a row when no conflict exists", async () => {
    const memory = createMemoryDb();
    const ws = await memory.insert("workspaces", {
      publicId: generateUID(),
      name: "W",
      slug: "w-" + generateUID(),
    });
    const { row, created } = await memory.insertIfAbsent(
      "auditLog",
      {
        workspaceId: ws.id,
        seq: 1,
        eventType: "card.created",
        entityType: "card",
        entityPublicId: generateUID(),
        payload: { a: 1 },
        hash: "h1",
        prevHash: null,
      },
      ["workspaceId", "seq"],
    );
    expect(created).toBe(true);
    expect(row.seq).toBe(1);
  });

  it("returns created:false and the existing row on conflict keys", async () => {
    const memory = createMemoryDb();
    const ws = await memory.insert("workspaces", {
      publicId: generateUID(),
      name: "W",
      slug: "w-" + generateUID(),
    });
    const first = await memory.insertIfAbsent(
      "auditLog",
      {
        workspaceId: ws.id,
        seq: 1,
        eventType: "card.created",
        entityType: "card",
        entityPublicId: generateUID(),
        payload: { a: 1 },
        hash: "h1",
        prevHash: null,
      },
      ["workspaceId", "seq"],
    );
    const second = await memory.insertIfAbsent(
      "auditLog",
      {
        workspaceId: ws.id,
        seq: 1,
        eventType: "card.updated",
        entityType: "card",
        entityPublicId: generateUID(),
        payload: { a: 2 },
        hash: "h2",
        prevHash: null,
      },
      ["workspaceId", "seq"],
    );
    expect(second.created).toBe(false);
    expect(second.row.id).toBe(first.row.id);
    expect(second.row.eventType).toBe("card.created");
  });
});

describe("updateWhere", () => {
  it("defaults to includeDeleted:true — updates soft-deleted rows too", async () => {
    const memory = createMemoryDb();
    const ws = await memory.insert("workspaces", {
      publicId: generateUID(),
      name: "W",
      slug: "w-" + generateUID(),
    });
    const member = await memory.insert("workspaceMembers", {
      publicId: generateUID(),
      workspaceId: ws.id,
      userId: "user-1",
      role: "member",
    });
    await memory.softDelete("workspaceMembers", member.id as number);

    const updated = await memory.updateWhere(
      "workspaceMembers",
      { publicId: member.publicId },
      { role: "admin" },
    );
    expect(updated).toHaveLength(1);
    expect(updated[0]?.role).toBe("admin");
  });

  it("respects includeDeleted:false — skips soft-deleted rows", async () => {
    const memory = createMemoryDb();
    const ws = await memory.insert("workspaces", {
      publicId: generateUID(),
      name: "W",
      slug: "w-" + generateUID(),
    });
    const member = await memory.insert("workspaceMembers", {
      publicId: generateUID(),
      workspaceId: ws.id,
      userId: "user-2",
      role: "member",
    });
    await memory.softDelete("workspaceMembers", member.id as number);

    const updated = await memory.updateWhere(
      "workspaceMembers",
      { publicId: member.publicId },
      { role: "admin" },
      { includeDeleted: false },
    );
    expect(updated).toHaveLength(0);
  });
});

describe("findMany deleted-row filtering", () => {
  it("excludes deleted rows by default on a soft-delete table", async () => {
    const memory = createMemoryDb();
    const ws = await memory.insert("workspaces", {
      publicId: generateUID(),
      name: "W",
      slug: "w-" + generateUID(),
    });
    const m1 = await memory.insert("workspaceMembers", {
      publicId: generateUID(),
      workspaceId: ws.id,
      userId: "user-a",
      role: "member",
    });
    await memory.insert("workspaceMembers", {
      publicId: generateUID(),
      workspaceId: ws.id,
      userId: "user-b",
      role: "member",
    });
    await memory.softDelete("workspaceMembers", m1.id as number);

    const active = await memory.findMany("workspaceMembers", {
      where: { workspaceId: ws.id },
    });
    expect(active).toHaveLength(1);
    expect(active[0]?.userId).toBe("user-b");
  });

  it("onlyDeleted returns just the soft-deleted rows", async () => {
    const memory = createMemoryDb();
    const ws = await memory.insert("workspaces", {
      publicId: generateUID(),
      name: "W",
      slug: "w-" + generateUID(),
    });
    const m1 = await memory.insert("workspaceMembers", {
      publicId: generateUID(),
      workspaceId: ws.id,
      userId: "user-a",
      role: "member",
    });
    await memory.insert("workspaceMembers", {
      publicId: generateUID(),
      workspaceId: ws.id,
      userId: "user-b",
      role: "member",
    });
    await memory.softDelete("workspaceMembers", m1.id as number);

    const deleted = await memory.findMany("workspaceMembers", {
      where: { workspaceId: ws.id },
      onlyDeleted: true,
    });
    expect(deleted).toHaveLength(1);
    expect(deleted[0]?.userId).toBe("user-a");
  });

  it("includeDeleted returns both active and deleted rows", async () => {
    const memory = createMemoryDb();
    const ws = await memory.insert("workspaces", {
      publicId: generateUID(),
      name: "W",
      slug: "w-" + generateUID(),
    });
    const m1 = await memory.insert("workspaceMembers", {
      publicId: generateUID(),
      workspaceId: ws.id,
      userId: "user-a",
      role: "member",
    });
    await memory.insert("workspaceMembers", {
      publicId: generateUID(),
      workspaceId: ws.id,
      userId: "user-b",
      role: "member",
    });
    await memory.softDelete("workspaceMembers", m1.id as number);

    const all = await memory.findMany("workspaceMembers", {
      where: { workspaceId: ws.id },
      includeDeleted: true,
    });
    expect(all).toHaveLength(2);
  });
});

describe("orderBy + limit", () => {
  it("orders then limits, not the other way around", async () => {
    const memory = createMemoryDb();
    const ws = await memory.insert("workspaces", {
      publicId: generateUID(),
      name: "W",
      slug: "w-" + generateUID(),
    });
    for (let i = 0; i < 5; i++) {
      await memory.insert("workspaceMembers", {
        publicId: generateUID(),
        workspaceId: ws.id,
        userId: `user-${i}`,
        role: "member",
      });
    }
    const rows = await memory.findMany("workspaceMembers", {
      where: { workspaceId: ws.id },
      orderBy: { field: "userId", dir: "desc" },
      limit: 2,
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.userId).toBe("user-4");
    expect(rows[1]?.userId).toBe("user-3");
  });
});

describe("unique-key enforcement", () => {
  it("rejects a duplicate audit log (workspaceId, seq)", async () => {
    const memory = createMemoryDb();
    const ws = await memory.insert("workspaces", {
      publicId: generateUID(),
      name: "W",
      slug: "w-" + generateUID(),
    });
    await memory.insert("auditLog", {
      workspaceId: ws.id,
      seq: 1,
      eventType: "card.created",
      entityType: "card",
      entityPublicId: generateUID(),
      payload: {},
      hash: "h1",
      prevHash: null,
    });
    await expect(
      memory.insert("auditLog", {
        workspaceId: ws.id,
        seq: 1,
        eventType: "card.updated",
        entityType: "card",
        entityPublicId: generateUID(),
        payload: {},
        hash: "h2",
        prevHash: null,
      }),
    ).rejects.toThrow(/duplicate key/);
  });

  it("rejects a duplicate reaction (commentId, emoji, userId)", async () => {
    const memory = createMemoryDb();
    await memory.insert("commentReactions", {
      commentId: 1,
      emoji: "👍",
      userId: "user-x",
    });
    await expect(
      memory.insert("commentReactions", {
        commentId: 1,
        emoji: "👍",
        userId: "user-x",
      }),
    ).rejects.toThrow(/duplicate key/);
  });

  it("allows the same emoji from a different user", async () => {
    const memory = createMemoryDb();
    await memory.insert("commentReactions", {
      commentId: 1,
      emoji: "👍",
      userId: "user-x",
    });
    const row = await memory.insert("commentReactions", {
      commentId: 1,
      emoji: "👍",
      userId: "user-y",
    });
    expect(row.userId).toBe("user-y");
  });
});

describe("serverLimit", () => {
  it("MemoryGateway does not implement server-side paging", () => {
    const memory = createMemoryDb();
    // findMany takes FindOptions which includes serverLimit in the type,
    // but MemoryGateway's implementation never reads it — only the
    // NcbGateway (packages/db/src/ncb/gateway.ts) forwards it to NCB.
    // We don't test serverLimit behavior against MemoryGateway because
    // there is none to test; this is a documentation-only assertion.
    expect(typeof memory.findMany).toBe("function");
  });
});
