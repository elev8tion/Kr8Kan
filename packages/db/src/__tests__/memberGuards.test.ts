import { beforeAll, describe, expect, it } from "vitest";

import { generateUID } from "@kr8kan/shared";

import type { Database } from "../client";
import { createMemoryDb } from "../ncb/memory";
import * as workspaceRepo from "../repository/workspace";

/**
 * Workspace repo membership invariants against the in-memory gateway —
 * addMember idempotency, role updates, soft-delete on removal, and the
 * invite accept path. Workspace scoping of these calls is enforced at
 * the router level, so this only covers the repo contract itself.
 */
const memory = createMemoryDb();
const db = memory as unknown as Database;
let workspaceId: number;

beforeAll(async () => {
  const ws = await memory.insert("workspaces", {
    publicId: generateUID(),
    name: "Test",
    slug: "test-" + generateUID(),
  });
  workspaceId = ws.id as number;
});

describe("addMember", () => {
  it("creates a new membership", async () => {
    const userId = "user-" + generateUID();
    const member = await workspaceRepo.addMember(db, {
      workspaceId,
      userId,
      role: "member",
    });
    expect(member.userId).toBe(userId);
    expect(member.role).toBe("member");
    expect(member.deletedAt).toBeFalsy();
  });

  it("is idempotent — second add returns the existing membership", async () => {
    const userId = "user-" + generateUID();
    const first = await workspaceRepo.addMember(db, {
      workspaceId,
      userId,
      role: "member",
    });
    const second = await workspaceRepo.addMember(db, {
      workspaceId,
      userId,
      role: "admin",
    });
    // Same row returned; role from the second call is NOT applied.
    expect(second.publicId).toBe(first.publicId);
    expect(second.role).toBe("member");
  });
});

describe("updateMemberRole", () => {
  it("updates the role for the member's publicId", async () => {
    const userId = "user-" + generateUID();
    const member = await workspaceRepo.addMember(db, {
      workspaceId,
      userId,
      role: "member",
    });
    const updated = await workspaceRepo.updateMemberRole(
      db,
      member.publicId,
      "admin",
    );
    expect(updated?.role).toBe("admin");
    const reloaded = await workspaceRepo.getMemberByPublicId(db, member.publicId);
    expect(reloaded?.role).toBe("admin");
  });
});

describe("removeMember", () => {
  it("soft-deletes the member", async () => {
    const userId = "user-" + generateUID();
    const member = await workspaceRepo.addMember(db, {
      workspaceId,
      userId,
      role: "member",
    });
    await workspaceRepo.removeMember(db, member.publicId);
    const raw = memory.raw("workspace_member");
    let found = false;
    for (const row of raw.values()) {
      if (row.public_id === member.publicId) {
        found = true;
        expect(row.deleted_at).toBeTruthy();
      }
    }
    expect(found).toBe(true);
  });

  it("getMembership excludes removed members", async () => {
    const userId = "user-" + generateUID();
    const member = await workspaceRepo.addMember(db, {
      workspaceId,
      userId,
      role: "member",
    });
    expect(await workspaceRepo.getMembership(db, userId, workspaceId)).toBeTruthy();
    await workspaceRepo.removeMember(db, member.publicId);
    expect(
      await workspaceRepo.getMembership(db, userId, workspaceId),
    ).toBeUndefined();
  });
});

describe("invites", () => {
  it("getInviteByPublicId returns the invite", async () => {
    const invite = await workspaceRepo.createInvite(db, {
      workspaceId,
      role: "member",
      createdBy: "user-" + generateUID(),
    });
    const found = await workspaceRepo.getInviteByPublicId(db, invite.publicId);
    expect(found?.id).toBe(invite.id);
    expect(found?.workspaceId).toBe(workspaceId);
  });

  it("acceptInvite marks acceptedAt and creates the member", async () => {
    const userId = "user-" + generateUID();
    const invite = await workspaceRepo.createInvite(db, {
      workspaceId,
      role: "admin",
      createdBy: "user-" + generateUID(),
    });
    expect(invite.acceptedAt).toBeFalsy();

    const member = await workspaceRepo.acceptInvite(db, invite.id, userId);
    expect(member.userId).toBe(userId);
    expect(member.role).toBe("admin");

    const reloadedInvite = await workspaceRepo.getInviteByPublicId(
      db,
      invite.publicId,
    );
    expect(reloadedInvite?.acceptedAt).toBeTruthy();

    const membership = await workspaceRepo.getMembership(db, userId, workspaceId);
    expect(membership).toBeTruthy();
  });

  it("acceptInvite is idempotent through addMember on re-accept", async () => {
    const userId = "user-" + generateUID();
    const invite = await workspaceRepo.createInvite(db, {
      workspaceId,
      role: "member",
      createdBy: "user-" + generateUID(),
    });
    const first = await workspaceRepo.acceptInvite(db, invite.id, userId);
    const second = await workspaceRepo.acceptInvite(db, invite.id, userId);
    expect(second.publicId).toBe(first.publicId);
  });
});
