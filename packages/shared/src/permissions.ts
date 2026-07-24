/**
 * Kr8Kan RBAC — roles + permission strings for members of a single
 * self-hosted instance. There are no plan gates: every feature is
 * available to every workspace; permissions only control *who* inside
 * a workspace may do *what*.
 */

export const WORKSPACE_ROLES = ["admin", "member", "guest"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const PERMISSIONS = [
  "workspace:view",
  "workspace:edit",
  "workspace:delete",
  "member:view",
  "member:invite",
  "member:manage",
  "board:view",
  "board:create",
  "board:edit",
  "board:delete",
  "list:create",
  "list:edit",
  "list:delete",
  "card:view",
  "card:create",
  "card:edit",
  "card:move",
  "card:delete",
  "card:comment",
  "label:manage",
  "webhook:manage",
  "apikey:manage",
  "agent:run",
  "agent:manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const GUEST_PERMISSIONS: Permission[] = [
  "workspace:view",
  "member:view",
  "board:view",
  "card:view",
  "card:comment",
];

const MEMBER_PERMISSIONS: Permission[] = [
  ...GUEST_PERMISSIONS,
  "board:create",
  "board:edit",
  "list:create",
  "list:edit",
  "list:delete",
  "card:create",
  "card:edit",
  "card:move",
  "card:delete",
  "label:manage",
  "agent:run",
];

const ADMIN_PERMISSIONS: Permission[] = [...PERMISSIONS];

export const ROLE_PERMISSIONS: Record<WorkspaceRole, readonly Permission[]> = {
  admin: ADMIN_PERMISSIONS,
  member: MEMBER_PERMISSIONS,
  guest: GUEST_PERMISSIONS,
};

export function roleHasPermission(
  role: WorkspaceRole,
  permission: Permission,
): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Self-host: single plan, everything unlocked. Kept as a named constant so
 * upstream-style `plan` checks read clearly and can never gate features. */
export const SELFHOST_PLAN = "selfhost" as const;
