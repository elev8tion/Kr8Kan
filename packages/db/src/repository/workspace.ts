import { and, asc, eq, isNull } from "drizzle-orm";

import type { WorkspaceRole } from "@kr8kan/shared";
import { generateUID, uniqueSlug } from "@kr8kan/shared";

import type { Database } from "../client";
import {
  user,
  workspaceInvites,
  workspaceMembers,
  workspaces,
} from "../schema";

export async function createWorkspace(
  db: Database,
  input: { name: string; userId: string; description?: string },
) {
  return db.transaction(async (tx) => {
    const [workspace] = await tx
      .insert(workspaces)
      .values({
        publicId: generateUID(),
        name: input.name,
        slug: uniqueSlug(input.name),
        description: input.description,
        createdBy: input.userId,
      })
      .returning();
    if (!workspace) throw new Error("failed to create workspace");
    await tx.insert(workspaceMembers).values({
      publicId: generateUID(),
      workspaceId: workspace.id,
      userId: input.userId,
      role: "admin",
    });
    return workspace;
  });
}

export async function getWorkspaceByPublicId(db: Database, publicId: string) {
  return db.query.workspaces.findFirst({
    where: and(eq(workspaces.publicId, publicId), isNull(workspaces.deletedAt)),
  });
}

export async function getWorkspaceBySlug(db: Database, slug: string) {
  return db.query.workspaces.findFirst({
    where: and(eq(workspaces.slug, slug), isNull(workspaces.deletedAt)),
  });
}

export async function listWorkspacesForUser(db: Database, userId: string) {
  const memberships = await db.query.workspaceMembers.findMany({
    where: and(
      eq(workspaceMembers.userId, userId),
      isNull(workspaceMembers.deletedAt),
    ),
    with: { workspace: true },
    orderBy: asc(workspaceMembers.createdAt),
  });
  return memberships
    .filter((m) => m.workspace && !m.workspace.deletedAt)
    .map((m) => ({ ...m.workspace, role: m.role }));
}

export async function getWorkspaceById(db: Database, id: number) {
  return db.query.workspaces.findFirst({ where: eq(workspaces.id, id) });
}

export async function updateWorkspace(
  db: Database,
  workspaceId: number,
  input: {
    name?: string;
    description?: string | null;
    settings?: { judgeEnabled?: boolean };
  },
) {
  const [updated] = await db
    .update(workspaces)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(workspaces.id, workspaceId))
    .returning();
  return updated;
}

export async function softDeleteWorkspace(db: Database, workspaceId: number) {
  await db
    .update(workspaces)
    .set({ deletedAt: new Date() })
    .where(eq(workspaces.id, workspaceId));
}

/* ── members ───────────────────────────────────────────────────── */

export async function getMembership(
  db: Database,
  userId: string,
  workspaceId: number,
) {
  return db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.userId, userId),
      eq(workspaceMembers.workspaceId, workspaceId),
      isNull(workspaceMembers.deletedAt),
    ),
  });
}

export async function listMembers(db: Database, workspaceId: number) {
  return db.query.workspaceMembers.findMany({
    where: and(
      eq(workspaceMembers.workspaceId, workspaceId),
      isNull(workspaceMembers.deletedAt),
    ),
    with: { user: true },
    orderBy: asc(workspaceMembers.createdAt),
  });
}

export async function addMember(
  db: Database,
  input: { workspaceId: number; userId: string; role: WorkspaceRole },
) {
  const existing = await getMembership(db, input.userId, input.workspaceId);
  if (existing) return existing;
  const [member] = await db
    .insert(workspaceMembers)
    .values({ publicId: generateUID(), ...input })
    .returning();
  return member;
}

export async function updateMemberRole(
  db: Database,
  memberPublicId: string,
  role: WorkspaceRole,
) {
  const [updated] = await db
    .update(workspaceMembers)
    .set({ role })
    .where(eq(workspaceMembers.publicId, memberPublicId))
    .returning();
  return updated;
}

export async function removeMember(db: Database, memberPublicId: string) {
  await db
    .update(workspaceMembers)
    .set({ deletedAt: new Date() })
    .where(eq(workspaceMembers.publicId, memberPublicId));
}

export async function getMemberByPublicId(db: Database, publicId: string) {
  return db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.publicId, publicId),
      isNull(workspaceMembers.deletedAt),
    ),
    with: { user: true },
  });
}

/* ── invites ───────────────────────────────────────────────────── */

export async function createInvite(
  db: Database,
  input: {
    workspaceId: number;
    role: WorkspaceRole;
    email?: string;
    createdBy: string;
    expiresAt?: Date;
  },
) {
  const [invite] = await db
    .insert(workspaceInvites)
    .values({
      publicId: generateUID(),
      code: generateUID(24),
      ...input,
    })
    .returning();
  return invite;
}

export async function getInviteByCode(db: Database, code: string) {
  return db.query.workspaceInvites.findFirst({
    where: and(
      eq(workspaceInvites.code, code),
      isNull(workspaceInvites.deletedAt),
    ),
    with: { workspace: true },
  });
}

export async function listInvites(db: Database, workspaceId: number) {
  return db.query.workspaceInvites.findMany({
    where: and(
      eq(workspaceInvites.workspaceId, workspaceId),
      isNull(workspaceInvites.deletedAt),
    ),
    orderBy: asc(workspaceInvites.createdAt),
  });
}

export async function acceptInvite(
  db: Database,
  inviteId: number,
  userId: string,
) {
  return db.transaction(async (tx) => {
    const invite = await tx.query.workspaceInvites.findFirst({
      where: eq(workspaceInvites.id, inviteId),
    });
    if (!invite) throw new Error("invite not found");
    const member = await addMember(tx as unknown as Database, {
      workspaceId: invite.workspaceId,
      userId,
      role: invite.role,
    });
    await tx
      .update(workspaceInvites)
      .set({ acceptedAt: new Date() })
      .where(eq(workspaceInvites.id, inviteId));
    return member;
  });
}

export async function revokeInvite(db: Database, invitePublicId: string) {
  await db
    .update(workspaceInvites)
    .set({ deletedAt: new Date() })
    .where(eq(workspaceInvites.publicId, invitePublicId));
}

export async function getUserById(db: Database, id: string) {
  return db.query.user.findFirst({ where: eq(user.id, id) });
}
