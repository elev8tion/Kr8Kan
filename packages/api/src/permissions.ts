import { TRPCError } from "@trpc/server";

import type { Database } from "@kr8kan/db";
import { workspaceRepo } from "@kr8kan/db";
import type { Permission } from "@kr8kan/shared";
import { roleHasPermission } from "@kr8kan/shared";

/**
 * Membership + permission assertion. All features are unlocked on a
 * self-hosted instance; the only gates are workspace roles.
 */
export async function assertPermission(
  db: Database,
  userId: string,
  workspaceId: number,
  permission: Permission,
) {
  const membership = await workspaceRepo.getMembership(db, userId, workspaceId);
  if (!membership) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You are not a member of this workspace",
    });
  }
  if (!roleHasPermission(membership.role, permission)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Your role (${membership.role}) lacks the ${permission} permission`,
    });
  }
  return membership;
}

export function notFound(entity: string): never {
  throw new TRPCError({ code: "NOT_FOUND", message: `${entity} not found` });
}
