import type { WorkspaceRole } from "@kr8kan/shared";
import { generateUID, uniqueSlug } from "@kr8kan/shared";

import type { Database } from "../client";
import type {
  user,
  workspaceInvites,
  workspaceMembers,
  workspaces,
} from "../schema";

type WorkspaceRow = typeof workspaces.$inferSelect;
type MemberRow = typeof workspaceMembers.$inferSelect;
type InviteRow = typeof workspaceInvites.$inferSelect;
type UserRow = typeof user.$inferSelect;

export async function createWorkspace(
  db: Database,
  input: { name: string; userId: string; description?: string },
) {
  return db.transaction(async (tx) => {
    const workspace = (await tx.insert("workspaces", {
      publicId: generateUID(),
      name: input.name,
      slug: uniqueSlug(input.name),
      description: input.description,
      settings: {},
      createdBy: input.userId,
    })) as WorkspaceRow;
    if (!workspace) throw new Error("failed to create workspace");
    await tx.insert("workspaceMembers", {
      publicId: generateUID(),
      workspaceId: workspace.id,
      userId: input.userId,
      role: "admin",
    });
    return workspace;
  });
}

export async function getWorkspaceByPublicId(db: Database, publicId: string) {
  return (await db.findFirst("workspaces", { where: { publicId } })) as
    | WorkspaceRow
    | undefined;
}

export async function getWorkspaceBySlug(db: Database, slug: string) {
  return (await db.findFirst("workspaces", { where: { slug } })) as
    | WorkspaceRow
    | undefined;
}

export async function listWorkspacesForUser(db: Database, userId: string) {
  const memberships = (await db.findMany("workspaceMembers", {
    where: { userId },
    orderBy: { field: "createdAt" },
  })) as MemberRow[];
  const allWorkspaces = (await db.findMany("workspaces")) as WorkspaceRow[];
  const byId = new Map(allWorkspaces.map((w) => [w.id, w]));
  return memberships
    .map((m) => ({ workspace: byId.get(m.workspaceId), role: m.role }))
    .filter((m): m is { workspace: WorkspaceRow; role: MemberRow["role"] } =>
      Boolean(m.workspace && !m.workspace.deletedAt),
    )
    .map((m) => ({ ...m.workspace, role: m.role }));
}

export async function getWorkspaceById(db: Database, id: number) {
  return (await db.findFirst("workspaces", {
    where: { id },
    includeDeleted: true,
  })) as WorkspaceRow | undefined;
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
  return (await db.update("workspaces", workspaceId, {
    ...input,
    updatedAt: new Date(),
  })) as WorkspaceRow | undefined;
}

export async function softDeleteWorkspace(db: Database, workspaceId: number) {
  await db.update("workspaces", workspaceId, { deletedAt: new Date() });
}

/* ── members ───────────────────────────────────────────────────── */

export async function getMembership(
  db: Database,
  userId: string,
  workspaceId: number,
) {
  return (await db.findFirst("workspaceMembers", {
    where: { userId, workspaceId },
  })) as MemberRow | undefined;
}

export async function listMembers(db: Database, workspaceId: number) {
  const members = (await db.findMany("workspaceMembers", {
    where: { workspaceId },
    orderBy: { field: "createdAt" },
  })) as MemberRow[];
  const users = (await db.findMany("user")) as UserRow[];
  const usersById = new Map(users.map((u) => [u.id, u]));
  return members.map((m) => ({
    ...m,
    user: (usersById.get(m.userId) ?? null) as UserRow,
  }));
}

export async function addMember(
  db: Database,
  input: { workspaceId: number; userId: string; role: WorkspaceRole },
) {
  const existing = await getMembership(db, input.userId, input.workspaceId);
  if (existing) return existing;
  return (await db.insert("workspaceMembers", {
    publicId: generateUID(),
    ...input,
  })) as MemberRow;
}

export async function updateMemberRole(
  db: Database,
  memberPublicId: string,
  role: WorkspaceRole,
) {
  const [updated] = (await db.updateWhere(
    "workspaceMembers",
    { publicId: memberPublicId },
    { role },
  )) as MemberRow[];
  return updated;
}

export async function removeMember(db: Database, memberPublicId: string) {
  await db.updateWhere(
    "workspaceMembers",
    { publicId: memberPublicId },
    { deletedAt: new Date() },
  );
}

export async function getMemberByPublicId(db: Database, publicId: string) {
  const member = (await db.findFirst("workspaceMembers", {
    where: { publicId },
  })) as MemberRow | undefined;
  if (!member) return undefined;
  const memberUser = (await db.findFirst("user", {
    where: { id: member.userId },
  })) as UserRow | undefined;
  return { ...member, user: (memberUser ?? null) as UserRow };
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
  return (await db.insert("workspaceInvites", {
    publicId: generateUID(),
    code: generateUID(24),
    ...input,
  })) as InviteRow;
}

export async function getInviteByCode(db: Database, code: string) {
  const invite = (await db.findFirst("workspaceInvites", {
    where: { code },
  })) as InviteRow | undefined;
  if (!invite) return undefined;
  const workspace = (await db.findFirst("workspaces", {
    where: { id: invite.workspaceId },
    includeDeleted: true,
  })) as WorkspaceRow | undefined;
  return { ...invite, workspace: (workspace ?? null) as WorkspaceRow };
}

export async function listInvites(db: Database, workspaceId: number) {
  return (await db.findMany("workspaceInvites", {
    where: { workspaceId },
    orderBy: { field: "createdAt" },
  })) as InviteRow[];
}

export async function acceptInvite(
  db: Database,
  inviteId: number,
  userId: string,
) {
  return db.transaction(async (tx) => {
    const invite = (await tx.findFirst("workspaceInvites", {
      where: { id: inviteId },
      includeDeleted: true,
    })) as InviteRow | undefined;
    if (!invite) throw new Error("invite not found");
    const member = await addMember(tx as unknown as Database, {
      workspaceId: invite.workspaceId,
      userId,
      role: invite.role,
    });
    await tx.update("workspaceInvites", inviteId, { acceptedAt: new Date() });
    return member;
  });
}

export async function revokeInvite(db: Database, invitePublicId: string) {
  await db.updateWhere(
    "workspaceInvites",
    { publicId: invitePublicId },
    { deletedAt: new Date() },
  );
}

export async function getUserById(db: Database, id: string) {
  return (await db.findFirst("user", { where: { id } })) as
    | UserRow
    | undefined;
}
