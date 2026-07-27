/**
 * Table specs: how each logical (Drizzle-named, camelCase) entity maps
 * onto its NCB/MySQL table. Defaults: camelCase ↔ snake_case. `renames`
 * covers MySQL reserved-word deviations (index→position, trigger→
 * trigger_config, key→api_key/file_key) and the user table's text id
 * living in `auth_id` (NCB requires an int PK, which stays internal).
 * `bool` columns are TINYINT 0/1, `json` columns are TEXT holding JSON,
 * `date` columns are DATETIME strings in UTC.
 */

export interface TableSpec {
  /** Physical NCB table name. */
  table: string;
  /** jsName → column overrides (beyond camel→snake). */
  renames?: Record<string, string>;
  bool?: string[];
  json?: string[];
  date?: string[];
  /** jsNames auto-filled with `new Date()` on insert when absent. */
  autoNow?: string[];
  /** Table has a deleted_at column (enables default not-deleted filter). */
  softDelete?: boolean;
  /**
   * Composite unique business key (jsNames) used to probe whether an
   * ambiguous (5xx) create actually committed, for tables without a
   * caller-generated unique string field (publicId / text id / email).
   * Mirrors the DB UNIQUE constraint — e.g. auditLog (workspace_id, seq).
   */
  probeKeys?: string[];
}

export const T = {
  user: {
    table: "user",
    renames: { id: "auth_id" },
    bool: ["emailVerified"],
    date: ["createdAt", "updatedAt"],
    autoNow: ["createdAt", "updatedAt"],
  },
  session: {
    table: "session",
    renames: { id: "auth_id" },
    date: ["expiresAt", "createdAt", "updatedAt"],
    autoNow: ["createdAt", "updatedAt"],
  },
  account: {
    table: "account",
    renames: { id: "auth_id" },
    date: [
      "accessTokenExpiresAt",
      "refreshTokenExpiresAt",
      "createdAt",
      "updatedAt",
    ],
    autoNow: ["createdAt", "updatedAt"],
  },
  verification: {
    table: "verification",
    renames: { id: "auth_id" },
    date: ["expiresAt", "createdAt", "updatedAt"],
    autoNow: ["createdAt", "updatedAt"],
  },
  apikey: {
    table: "apikey",
    renames: { id: "auth_id", key: "api_key" },
    bool: ["enabled", "rateLimitEnabled"],
    date: [
      "lastRefillAt",
      "lastRequest",
      "expiresAt",
      "createdAt",
      "updatedAt",
    ],
    autoNow: ["createdAt", "updatedAt"],
  },
  workspaces: {
    table: "workspace",
    json: ["settings"],
    date: ["createdAt", "updatedAt", "deletedAt"],
    autoNow: ["createdAt", "updatedAt"],
    softDelete: true,
  },
  workspaceMembers: {
    table: "workspace_member",
    date: ["createdAt", "deletedAt"],
    autoNow: ["createdAt"],
    softDelete: true,
  },
  workspaceInvites: {
    table: "workspace_invite",
    date: ["expiresAt", "acceptedAt", "createdAt", "deletedAt"],
    autoNow: ["createdAt"],
    softDelete: true,
  },
  boards: {
    table: "board",
    date: ["createdAt", "updatedAt", "deletedAt"],
    autoNow: ["createdAt", "updatedAt"],
    softDelete: true,
  },
  lists: {
    table: "list",
    renames: { index: "position" },
    date: ["createdAt", "updatedAt", "deletedAt"],
    autoNow: ["createdAt", "updatedAt"],
    softDelete: true,
  },
  cards: {
    table: "card",
    renames: { index: "position" },
    date: ["dueDate", "createdAt", "updatedAt", "deletedAt"],
    autoNow: ["createdAt", "updatedAt"],
    softDelete: true,
  },
  labels: {
    table: "label",
    date: ["createdAt", "deletedAt"],
    autoNow: ["createdAt"],
    softDelete: true,
  },
  cardLabels: {
    table: "card_label",
    date: ["createdAt"],
    autoNow: ["createdAt"],
    probeKeys: ["cardId", "labelId"],
  },
  cardMembers: {
    table: "card_member",
    date: ["createdAt"],
    autoNow: ["createdAt"],
    probeKeys: ["cardId", "memberId"],
  },
  cardTemplates: {
    table: "card_template",
    json: ["checklist", "labels"],
    date: ["createdAt", "updatedAt", "deletedAt"],
    autoNow: ["createdAt", "updatedAt"],
    softDelete: true,
  },
  checklists: {
    table: "checklist",
    renames: { index: "position" },
    date: ["createdAt", "deletedAt"],
    autoNow: ["createdAt"],
    softDelete: true,
  },
  checklistItems: {
    table: "checklist_item",
    renames: { index: "position" },
    bool: ["completed"],
    date: ["createdAt", "deletedAt"],
    autoNow: ["createdAt"],
    softDelete: true,
  },
  comments: {
    table: "comment",
    date: ["createdAt", "updatedAt", "deletedAt"],
    autoNow: ["createdAt", "updatedAt"],
    softDelete: true,
  },
  commentReactions: {
    table: "comment_reaction",
    date: ["createdAt"],
    autoNow: ["createdAt"],
    probeKeys: ["commentId", "emoji", "userId"],
  },
  activities: {
    table: "card_activity",
    json: ["metadata"],
    date: ["createdAt"],
    autoNow: ["createdAt"],
  },
  attachments: {
    table: "attachment",
    renames: { key: "file_key" },
    date: ["createdAt", "deletedAt"],
    autoNow: ["createdAt"],
    softDelete: true,
  },
  agentIdentities: {
    table: "agent_identity",
    date: ["createdAt", "deletedAt"],
    autoNow: ["createdAt"],
    softDelete: true,
  },
  agentJobs: {
    table: "agent_job",
    bool: ["toolsUsed", "sandbox", "patchTruncated"],
    json: [
      "resultParsed",
      "appliedActions",
      "events",
      "contextIds",
      "evalReasons",
      "promptFlags",
    ],
    date: ["createdAt", "startedAt", "completedAt", "patchAppliedAt"],
    autoNow: ["createdAt"],
  },
  customWorkers: {
    table: "custom_worker",
    date: ["createdAt", "updatedAt", "deletedAt"],
    autoNow: ["createdAt", "updatedAt"],
    softDelete: true,
  },
  boardNotes: {
    table: "board_note",
    date: ["createdAt", "updatedAt"],
    autoNow: ["createdAt", "updatedAt"],
  },
  workflows: {
    table: "workflow",
    renames: { trigger: "trigger_config" },
    bool: ["enabled"],
    json: ["trigger", "steps"],
    date: ["lastFiredAt", "createdAt", "updatedAt", "deletedAt"],
    autoNow: ["createdAt", "updatedAt"],
    softDelete: true,
  },
  workflowRuns: {
    table: "workflow_run",
    json: ["triggerEvent", "stepResults"],
    date: ["gateExpiresAt", "startedAt", "completedAt", "updatedAt"],
    autoNow: ["startedAt", "updatedAt"],
  },
  webhooks: {
    table: "webhook",
    bool: ["enabled"],
    json: ["events"],
    date: ["createdAt", "deletedAt"],
    autoNow: ["createdAt"],
    softDelete: true,
  },
  channels: {
    table: "channel",
    date: ["archivedAt", "createdAt", "updatedAt", "deletedAt"],
    autoNow: ["createdAt", "updatedAt"],
    softDelete: true,
  },
  channelMembers: {
    table: "channel_member",
    date: ["createdAt", "deletedAt"],
    autoNow: ["createdAt"],
    softDelete: true,
  },
  messages: {
    table: "message",
    date: ["editedAt", "createdAt", "updatedAt", "deletedAt"],
    autoNow: ["createdAt", "updatedAt"],
    softDelete: true,
  },
  messageReactions: {
    table: "message_reaction",
    date: ["createdAt"],
    autoNow: ["createdAt"],
    probeKeys: ["messageId", "emoji", "userId"],
  },
  auditLog: {
    table: "audit_log",
    json: ["payload"],
    date: ["createdAt"],
    autoNow: ["createdAt"],
    // UNIQUE(workspace_id, seq) — lets an ambiguous create be probed
    // instead of rethrown (the append hash chain must not drop entries
    // just because NCB's 5xx hid a commit). The row's `hash` scalar is
    // what attributes a probed row to the original insert.
    probeKeys: ["workspaceId", "seq"],
  },
} as const satisfies Record<string, TableSpec>;

export type TableName = keyof typeof T;

/** Wide-typed view of the specs (optional props accessible). */
export const specs: Record<TableName, TableSpec> = T;
