import { relations } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

/**
 * Kr8Kan domain model (Kan-style): workspace → board → list → card,
 * publicId (12-char) on every URL-addressable entity, soft delete via
 * deletedAt, activity log per card, RBAC via workspace member roles.
 *
 * Intentional self-host deltas from upstream Kan:
 *  - workspace.plan is a single `selfhost` value; nothing gates on it
 *  - no subscription table, no Stripe customer sync
 */

export const workspaceRoleEnum = pgEnum("workspace_role", [
  "admin",
  "member",
  "guest",
]);

export const boardVisibilityEnum = pgEnum("board_visibility", [
  "private",
  "public",
]);

const publicId = () => varchar("public_id", { length: 12 }).notNull();
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const deletedAt = () => timestamp("deleted_at", { withTimezone: true });

export const workspaces = pgTable(
  "workspace",
  {
    id: serial("id").primaryKey(),
    publicId: publicId(),
    name: varchar("name", { length: 120 }).notNull(),
    slug: varchar("slug", { length: 64 }).notNull(),
    description: text("description"),
    plan: varchar("plan", { length: 24 }).notNull().default("selfhost"),
    /** Operator toggles (e.g. judgeEnabled) — additive, no per-flag columns. */
    settings: jsonb("settings")
      .$type<{ judgeEnabled?: boolean }>()
      .notNull()
      .default({}),
    createdBy: text("created_by").references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("workspace_public_id_idx").on(t.publicId),
    uniqueIndex("workspace_slug_idx").on(t.slug),
  ],
);

export const workspaceMembers = pgTable(
  "workspace_member",
  {
    id: serial("id").primaryKey(),
    publicId: publicId(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: workspaceRoleEnum("role").notNull().default("member"),
    createdAt: createdAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("workspace_member_public_id_idx").on(t.publicId),
    index("workspace_member_workspace_idx").on(t.workspaceId),
    index("workspace_member_user_idx").on(t.userId),
  ],
);

export const workspaceInvites = pgTable(
  "workspace_invite",
  {
    id: serial("id").primaryKey(),
    publicId: publicId(),
    code: varchar("code", { length: 24 }).notNull(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 254 }),
    role: workspaceRoleEnum("role").notNull().default("member"),
    createdBy: text("created_by").references(() => user.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: createdAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("workspace_invite_code_idx").on(t.code),
    index("workspace_invite_workspace_idx").on(t.workspaceId),
  ],
);

export const boards = pgTable(
  "board",
  {
    id: serial("id").primaryKey(),
    publicId: publicId(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 160 }).notNull(),
    slug: varchar("slug", { length: 64 }).notNull(),
    visibility: boardVisibilityEnum("visibility").notNull().default("private"),
    /** Absolute path of the local project folder tool-enabled Pi workers
     * run in. Validated against KR8KAN_PI_PROJECT_ROOTS at the API layer. */
    agentPath: text("agent_path"),
    /** Shell command run inside agentPath after a dev-task completes;
     * exit code + output tail land on the job as verifyStatus/verifyLog. */
    agentVerifyCommand: text("agent_verify_command"),
    createdBy: text("created_by").references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("board_public_id_idx").on(t.publicId),
    index("board_workspace_idx").on(t.workspaceId),
  ],
);

export const lists = pgTable(
  "list",
  {
    id: serial("id").primaryKey(),
    publicId: publicId(),
    boardId: integer("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 160 }).notNull(),
    index: integer("index").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("list_public_id_idx").on(t.publicId),
    index("list_board_idx").on(t.boardId),
  ],
);

export const cards = pgTable(
  "card",
  {
    id: serial("id").primaryKey(),
    publicId: publicId(),
    listId: integer("list_id")
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 500 }).notNull(),
    description: text("description"),
    index: integer("index").notNull().default(0),
    dueDate: timestamp("due_date", { withTimezone: true }),
    createdBy: text("created_by").references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("card_public_id_idx").on(t.publicId),
    index("card_list_idx").on(t.listId),
  ],
);

export const labels = pgTable(
  "label",
  {
    id: serial("id").primaryKey(),
    publicId: publicId(),
    boardId: integer("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 80 }).notNull(),
    colourCode: varchar("colour_code", { length: 24 }).notNull(),
    createdAt: createdAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("label_public_id_idx").on(t.publicId),
    index("label_board_idx").on(t.boardId),
  ],
);

export const cardLabels = pgTable(
  "card_label",
  {
    id: serial("id").primaryKey(),
    cardId: integer("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    labelId: integer("label_id")
      .notNull()
      .references(() => labels.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("card_label_unique_idx").on(t.cardId, t.labelId)],
);

export const cardMembers = pgTable(
  "card_member",
  {
    id: serial("id").primaryKey(),
    cardId: integer("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    memberId: integer("member_id")
      .notNull()
      .references(() => workspaceMembers.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("card_member_unique_idx").on(t.cardId, t.memberId)],
);

export const checklists = pgTable(
  "checklist",
  {
    id: serial("id").primaryKey(),
    publicId: publicId(),
    cardId: integer("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 160 }).notNull(),
    index: integer("index").notNull().default(0),
    createdAt: createdAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("checklist_public_id_idx").on(t.publicId),
    index("checklist_card_idx").on(t.cardId),
  ],
);

export const checklistItems = pgTable(
  "checklist_item",
  {
    id: serial("id").primaryKey(),
    publicId: publicId(),
    checklistId: integer("checklist_id")
      .notNull()
      .references(() => checklists.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 500 }).notNull(),
    completed: boolean("completed").notNull().default(false),
    index: integer("index").notNull().default(0),
    createdAt: createdAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("checklist_item_public_id_idx").on(t.publicId),
    index("checklist_item_checklist_idx").on(t.checklistId),
  ],
);

export const comments = pgTable(
  "comment",
  {
    id: serial("id").primaryKey(),
    publicId: publicId(),
    cardId: integer("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    comment: text("comment").notNull(),
    createdBy: text("created_by").references(() => user.id),
    /** Set when an agent authored this comment (operator in createdBy). */
    agentIdentityId: integer("agent_identity_id").references(
      () => agentIdentities.id,
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("comment_public_id_idx").on(t.publicId),
    index("comment_card_idx").on(t.cardId),
  ],
);

export const activities = pgTable(
  "card_activity",
  {
    id: serial("id").primaryKey(),
    publicId: publicId(),
    cardId: integer("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 64 }).notNull(),
    createdBy: text("created_by").references(() => user.id),
    /** Set when an agent performed the action (operator in createdBy). */
    agentIdentityId: integer("agent_identity_id").references(
      () => agentIdentities.id,
    ),
    metadata: jsonb("metadata"),
    createdAt: createdAt(),
  },
  (t) => [index("card_activity_card_idx").on(t.cardId)],
);

export const attachments = pgTable(
  "attachment",
  {
    id: serial("id").primaryKey(),
    publicId: publicId(),
    cardId: integer("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    filename: varchar("filename", { length: 255 }).notNull(),
    key: text("key").notNull(),
    contentType: varchar("content_type", { length: 127 }),
    size: integer("size"),
    createdBy: text("created_by").references(() => user.id),
    createdAt: createdAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("attachment_public_id_idx").on(t.publicId),
    index("attachment_card_idx").on(t.cardId),
  ],
);

export const agentIdentityKindEnum = pgEnum("agent_identity_kind", [
  "stock",
  "custom",
]);

/**
 * Agents as first-class members (Buzz-inspired): one identity row per
 * worker per workspace. Agent-authored comments/activity/jobs reference
 * it so agents render with their own name + avatar, distinct from the
 * human operator who triggered or approved the action.
 */
export const agentIdentities = pgTable(
  "agent_identity",
  {
    id: serial("id").primaryKey(),
    publicId: publicId(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    kind: agentIdentityKindEnum("kind").notNull().default("stock"),
    workerName: varchar("worker_name", { length: 64 }).notNull(),
    displayName: varchar("display_name", { length: 120 }).notNull(),
    /** Emoji or short glyph rendered in the avatar chip. */
    avatar: varchar("avatar", { length: 16 }).notNull().default("🤖"),
    createdBy: text("created_by").references(() => user.id),
    createdAt: createdAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("agent_identity_public_id_idx").on(t.publicId),
    uniqueIndex("agent_identity_worker_idx").on(t.workspaceId, t.workerName),
  ],
);

/**
 * Per-workspace hash-chained audit log. Integrity, not signatures:
 * hash = sha256(prevHash|seq|eventType|entityPublicId|payload|createdAt).
 * Tampering with any historical row breaks every hash after it.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    eventType: varchar("event_type", { length: 64 }).notNull(),
    entityType: varchar("entity_type", { length: 32 }).notNull(),
    entityPublicId: varchar("entity_public_id", { length: 32 }),
    actorUserId: text("actor_user_id").references(() => user.id),
    actorAgentId: integer("actor_agent_id").references(() => agentIdentities.id),
    payload: jsonb("payload"),
    prevHash: varchar("prev_hash", { length: 64 }).notNull(),
    hash: varchar("hash", { length: 64 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("audit_log_seq_idx").on(t.workspaceId, t.seq),
    index("audit_log_workspace_idx").on(t.workspaceId),
    index("audit_log_entity_idx").on(t.entityPublicId),
  ],
);

export const agentJobStatusEnum = pgEnum("agent_job_status", [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

/**
 * Durable Pi-worker job store. One row per worker run — the source of
 * truth for status/results (the runner's inFlight map only tracks live
 * process handles). Columns for parsed output, apply history and verify
 * results land here so the whole agent loop is auditable.
 */
export const agentJobs = pgTable(
  "agent_job",
  {
    id: serial("id").primaryKey(),
    publicId: varchar("public_id", { length: 32 }).notNull(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    boardPublicId: varchar("board_public_id", { length: 12 }),
    cardPublicId: varchar("card_public_id", { length: 12 }),
    worker: varchar("worker", { length: 64 }).notNull(),
    /** Custom workers: stock worker whose schema/apply preset is borrowed. */
    schemaWorker: varchar("schema_worker", { length: 64 }),
    agentIdentityId: integer("agent_identity_id").references(
      () => agentIdentities.id,
    ),
    status: agentJobStatusEnum("status").notNull().default("pending"),
    createdBy: text("created_by").references(() => user.id),
    prompt: text("prompt"),
    resultRaw: text("result_raw"),
    resultParsed: jsonb("result_parsed"),
    parseError: text("parse_error"),
    error: text("error"),
    projectPath: text("project_path"),
    piModel: varchar("pi_model", { length: 120 }),
    toolsUsed: boolean("tools_used").notNull().default(false),
    promptVersion: integer("prompt_version"),
    progress: text("progress"),
    verifyStatus: varchar("verify_status", { length: 16 }),
    verifyLog: text("verify_log"),
    /** Set when the run was dispatched from an @worker comment mention. */
    sourceCommentPublicId: varchar("source_comment_public_id", { length: 12 }),
    appliedActions: jsonb("applied_actions")
      .$type<{ index: number; entityPublicId?: string; at: string }[]>(),
    /** Bounded event trace captured by the runner (replayable "smoke"). */
    events: jsonb("events").$type<{ at: string; type: string; detail?: string }[]>(),
    /** publicId of the failed job this run retries (failure-context lineage). */
    retryOfPublicId: varchar("retry_of_public_id", { length: 32 }),
    /** Tools run executed in an isolated git worktree (live tree untouched). */
    sandbox: boolean("sandbox").notNull().default(false),
    /** Unified diff captured from the sandbox (bounded — 256 KB cap). */
    patch: text("patch"),
    /** Human summary of the patch, e.g. "3 files changed, +42 −7". */
    patchSummary: text("patch_summary"),
    /** Patch exceeded the size cap — stored truncated, apply blocked. */
    patchTruncated: boolean("patch_truncated").notNull().default(false),
    /** Set when a human applied the patch to the live folder. */
    patchAppliedAt: timestamp("patch_applied_at", { withTimezone: true }),
    /** Last patch-apply failure (conflict / lock / precondition). */
    patchApplyError: text("patch_apply_error"),
    /** Entity publicIds present in the worker's prompt context —
     * ground-truth set for grounding checks. */
    contextIds: jsonb("context_ids").$type<string[]>(),
    /** Eval-layer verdict: grounding_failed / judge_pass / judge_warn /
     * judge_failed. Failing states block the gated apply path. */
    evalStatus: varchar("eval_status", { length: 24 }),
    /** Human-readable reasons behind evalStatus. */
    evalReasons: jsonb("eval_reasons").$type<string[]>(),
    /** Injection-heuristic patterns that fired on interpolated content
     * (flag-only — never blocks). */
    promptFlags: jsonb("prompt_flags").$type<string[]>(),
    createdAt: createdAt(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("agent_job_public_id_idx").on(t.publicId),
    index("agent_job_workspace_idx").on(t.workspaceId),
    index("agent_job_status_idx").on(t.status),
    index("agent_job_created_by_idx").on(t.createdBy),
  ],
);

export const commentReactions = pgTable(
  "comment_reaction",
  {
    id: serial("id").primaryKey(),
    commentId: integer("comment_id")
      .notNull()
      .references(() => comments.id, { onDelete: "cascade" }),
    emoji: varchar("emoji", { length: 16 }).notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("comment_reaction_unique_idx").on(t.commentId, t.emoji, t.userId),
    index("comment_reaction_comment_idx").on(t.commentId),
  ],
);

export const workflowRunStatusEnum = pgEnum("workflow_run_status", [
  "running",
  "waiting_gate",
  "completed",
  "failed",
  "cancelled",
]);

/**
 * Buzz-inspired automations: trigger (board event / schedule / webhook)
 * → ordered steps (run worker / gate / apply / comment / webhook).
 * Trigger + steps are validated jsonb (zod schemas in @kr8kan/shared).
 */
export const workflows = pgTable(
  "workflow",
  {
    id: serial("id").primaryKey(),
    publicId: publicId(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    boardPublicId: varchar("board_public_id", { length: 12 }),
    name: varchar("name", { length: 160 }).notNull(),
    enabled: boolean("enabled").notNull().default(true),
    trigger: jsonb("trigger").notNull(),
    steps: jsonb("steps").notNull(),
    /** Caps/permissions for runs are checked against this human. */
    createdBy: text("created_by").references(() => user.id),
    lastFiredAt: timestamp("last_fired_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("workflow_public_id_idx").on(t.publicId),
    index("workflow_workspace_idx").on(t.workspaceId),
  ],
);

export const workflowRuns = pgTable(
  "workflow_run",
  {
    id: serial("id").primaryKey(),
    publicId: publicId(),
    workflowId: integer("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    status: workflowRunStatusEnum("status").notNull().default("running"),
    triggerEvent: jsonb("trigger_event"),
    stepResults: jsonb("step_results")
      .$type<{ step: number; type: string; ok: boolean; detail?: string }[]>(),
    currentStep: integer("current_step").notNull().default(0),
    cardPublicId: varchar("card_public_id", { length: 12 }),
    /** Gate bookkeeping (waiting_gate): the comment carrying the gate. */
    gateCommentPublicId: varchar("gate_comment_public_id", { length: 12 }),
    /** Channel-surface gates: the message carrying the gate (runs
     * triggered from a channel with no card park here instead). */
    gateMessagePublicId: varchar("gate_message_public_id", { length: 12 }),
    gateExpiresAt: timestamp("gate_expires_at", { withTimezone: true }),
    error: text("error"),
    startedAt: createdAt(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("workflow_run_public_id_idx").on(t.publicId),
    index("workflow_run_workflow_idx").on(t.workflowId),
    index("workflow_run_status_idx").on(t.status),
    index("workflow_run_gate_comment_idx").on(t.gateCommentPublicId),
    index("workflow_run_gate_message_idx").on(t.gateMessagePublicId),
  ],
);

/**
 * Workspace-defined custom workers (persona packs). Advisory-only —
 * never tools. Borrowing a stock schema reuses its parser + apply preset.
 */
export const customWorkers = pgTable(
  "custom_worker",
  {
    id: serial("id").primaryKey(),
    publicId: publicId(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 64 }).notNull(),
    title: varchar("title", { length: 120 }).notNull(),
    description: text("description"),
    avatar: varchar("avatar", { length: 16 }).notNull().default("✨"),
    systemPrompt: text("system_prompt").notNull(),
    needs: varchar("needs", { length: 8 }).notNull().default("either"),
    outputMode: varchar("output_mode", { length: 16 }).notNull().default("freeform"),
    /** Stock worker whose output schema + apply preset this borrows. */
    schemaWorker: varchar("schema_worker", { length: 64 }),
    promptVersion: integer("prompt_version").notNull().default(1),
    createdBy: text("created_by").references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("custom_worker_public_id_idx").on(t.publicId),
    uniqueIndex("custom_worker_name_idx").on(t.workspaceId, t.name),
  ],
);

/**
 * One markdown notes doc per board — the landing surface for board-scoped
 * agent output (standup digests, summaries) and human notes. Written by
 * humans (updatedBy) or agents via the postNote workflow step
 * (updatedByAgentId set, operator in updatedBy).
 */
export const boardNotes = pgTable(
  "board_note",
  {
    id: serial("id").primaryKey(),
    publicId: publicId(),
    boardId: integer("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    content: text("content").notNull().default(""),
    updatedBy: text("updated_by").references(() => user.id),
    updatedByAgentId: integer("updated_by_agent_id").references(
      () => agentIdentities.id,
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("board_note_public_id_idx").on(t.publicId),
    uniqueIndex("board_note_board_idx").on(t.boardId),
  ],
);

/**
 * Reusable card shapes (bug report, release checklist…). Labels are
 * stored as NAMES and resolved against the target board at instantiation
 * time, since labels are board-scoped entities.
 */
export const cardTemplates = pgTable(
  "card_template",
  {
    id: serial("id").primaryKey(),
    publicId: publicId(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    title: varchar("title", { length: 500 }).notNull(),
    description: text("description"),
    checklist: jsonb("checklist").$type<string[]>().notNull().default([]),
    labels: jsonb("labels").$type<string[]>().notNull().default([]),
    createdBy: text("created_by").references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("card_template_public_id_idx").on(t.publicId),
    uniqueIndex("card_template_name_idx").on(t.workspaceId, t.name),
  ],
);

/**
 * Buzz-style conversation surface: workspace-scoped channels holding
 * threaded messages. Humans and agents share one author model (createdBy
 * operator + optional agentIdentityId), exactly like comments. All
 * channels are workspace-visible; membership rows exist for future
 * privacy and notification targeting, not access control (yet).
 * Channels are never exposed through public boards.
 */
export const channels = pgTable(
  "channel",
  {
    id: serial("id").primaryKey(),
    publicId: publicId(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 80 }).notNull(),
    slug: varchar("slug", { length: 64 }).notNull(),
    topic: varchar("topic", { length: 250 }),
    /** Optional board this channel accompanies. */
    boardId: integer("board_id").references(() => boards.id),
    createdBy: text("created_by").references(() => user.id),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("channel_public_id_idx").on(t.publicId),
    index("channel_workspace_idx").on(t.workspaceId),
  ],
);

export const channelMembers = pgTable(
  "channel_member",
  {
    id: serial("id").primaryKey(),
    publicId: publicId(),
    channelId: integer("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    /** Exactly one of userId / agentIdentityId is set. */
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    agentIdentityId: integer("agent_identity_id").references(
      () => agentIdentities.id,
      { onDelete: "cascade" },
    ),
    createdAt: createdAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("channel_member_public_id_idx").on(t.publicId),
    index("channel_member_channel_idx").on(t.channelId),
  ],
);

export const messages = pgTable(
  "message",
  {
    id: serial("id").primaryKey(),
    publicId: publicId(),
    channelId: integer("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    /** Thread root this message replies to. Threads are one level deep,
     * Slack-style: a reply to a reply re-attaches to the root. */
    parentMessageId: integer("parent_message_id").references(
      (): AnyPgColumn => messages.id,
    ),
    createdBy: text("created_by").references(() => user.id),
    /** Set when an agent authored this message (operator in createdBy). */
    agentIdentityId: integer("agent_identity_id").references(
      () => agentIdentities.id,
    ),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("message_public_id_idx").on(t.publicId),
    index("message_channel_idx").on(t.channelId),
    index("message_parent_idx").on(t.parentMessageId),
  ],
);

export const messageReactions = pgTable(
  "message_reaction",
  {
    id: serial("id").primaryKey(),
    messageId: integer("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    emoji: varchar("emoji", { length: 16 }).notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("message_reaction_unique_idx").on(t.messageId, t.emoji, t.userId),
    index("message_reaction_message_idx").on(t.messageId),
  ],
);

export const webhooks = pgTable(
  "webhook",
  {
    id: serial("id").primaryKey(),
    publicId: publicId(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    events: jsonb("events").$type<string[]>().notNull().default([]),
    enabled: boolean("enabled").notNull().default(true),
    createdBy: text("created_by").references(() => user.id),
    createdAt: createdAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("webhook_public_id_idx").on(t.publicId),
    index("webhook_workspace_idx").on(t.workspaceId),
  ],
);

/* ── relations ─────────────────────────────────────────────────── */

export const workspacesRelations = relations(workspaces, ({ many }) => ({
  members: many(workspaceMembers),
  boards: many(boards),
  invites: many(workspaceInvites),
  webhooks: many(webhooks),
  channels: many(channels),
}));

export const channelsRelations = relations(channels, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [channels.workspaceId],
    references: [workspaces.id],
  }),
  board: one(boards, { fields: [channels.boardId], references: [boards.id] }),
  members: many(channelMembers),
  messages: many(messages),
}));

export const channelMembersRelations = relations(channelMembers, ({ one }) => ({
  channel: one(channels, {
    fields: [channelMembers.channelId],
    references: [channels.id],
  }),
  user: one(user, { fields: [channelMembers.userId], references: [user.id] }),
  agent: one(agentIdentities, {
    fields: [channelMembers.agentIdentityId],
    references: [agentIdentities.id],
  }),
}));

export const messagesRelations = relations(messages, ({ one, many }) => ({
  channel: one(channels, {
    fields: [messages.channelId],
    references: [channels.id],
  }),
  author: one(user, { fields: [messages.createdBy], references: [user.id] }),
  agent: one(agentIdentities, {
    fields: [messages.agentIdentityId],
    references: [agentIdentities.id],
  }),
  parent: one(messages, {
    fields: [messages.parentMessageId],
    references: [messages.id],
    relationName: "thread",
  }),
  replies: many(messages, { relationName: "thread" }),
  reactions: many(messageReactions),
}));

export const messageReactionsRelations = relations(
  messageReactions,
  ({ one }) => ({
    message: one(messages, {
      fields: [messageReactions.messageId],
      references: [messages.id],
    }),
    user: one(user, {
      fields: [messageReactions.userId],
      references: [user.id],
    }),
  }),
);

export const workspaceMembersRelations = relations(
  workspaceMembers,
  ({ one, many }) => ({
    workspace: one(workspaces, {
      fields: [workspaceMembers.workspaceId],
      references: [workspaces.id],
    }),
    user: one(user, {
      fields: [workspaceMembers.userId],
      references: [user.id],
    }),
    cards: many(cardMembers),
  }),
);

export const workspaceInvitesRelations = relations(
  workspaceInvites,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [workspaceInvites.workspaceId],
      references: [workspaces.id],
    }),
  }),
);

export const boardNotesRelations = relations(boardNotes, ({ one }) => ({
  board: one(boards, { fields: [boardNotes.boardId], references: [boards.id] }),
  author: one(user, { fields: [boardNotes.updatedBy], references: [user.id] }),
  agent: one(agentIdentities, {
    fields: [boardNotes.updatedByAgentId],
    references: [agentIdentities.id],
  }),
}));

export const cardTemplatesRelations = relations(cardTemplates, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [cardTemplates.workspaceId],
    references: [workspaces.id],
  }),
  author: one(user, {
    fields: [cardTemplates.createdBy],
    references: [user.id],
  }),
}));

export const boardsRelations = relations(boards, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [boards.workspaceId],
    references: [workspaces.id],
  }),
  lists: many(lists),
  labels: many(labels),
}));

export const listsRelations = relations(lists, ({ one, many }) => ({
  board: one(boards, { fields: [lists.boardId], references: [boards.id] }),
  cards: many(cards),
}));

export const cardsRelations = relations(cards, ({ one, many }) => ({
  list: one(lists, { fields: [cards.listId], references: [lists.id] }),
  labels: many(cardLabels),
  members: many(cardMembers),
  checklists: many(checklists),
  comments: many(comments),
  activities: many(activities),
  attachments: many(attachments),
  author: one(user, { fields: [cards.createdBy], references: [user.id] }),
}));

export const labelsRelations = relations(labels, ({ one, many }) => ({
  board: one(boards, { fields: [labels.boardId], references: [boards.id] }),
  cards: many(cardLabels),
}));

export const cardLabelsRelations = relations(cardLabels, ({ one }) => ({
  card: one(cards, { fields: [cardLabels.cardId], references: [cards.id] }),
  label: one(labels, {
    fields: [cardLabels.labelId],
    references: [labels.id],
  }),
}));

export const cardMembersRelations = relations(cardMembers, ({ one }) => ({
  card: one(cards, { fields: [cardMembers.cardId], references: [cards.id] }),
  member: one(workspaceMembers, {
    fields: [cardMembers.memberId],
    references: [workspaceMembers.id],
  }),
}));

export const checklistsRelations = relations(checklists, ({ one, many }) => ({
  card: one(cards, { fields: [checklists.cardId], references: [cards.id] }),
  items: many(checklistItems),
}));

export const checklistItemsRelations = relations(checklistItems, ({ one }) => ({
  checklist: one(checklists, {
    fields: [checklistItems.checklistId],
    references: [checklists.id],
  }),
}));

export const commentsRelations = relations(comments, ({ one, many }) => ({
  card: one(cards, { fields: [comments.cardId], references: [cards.id] }),
  author: one(user, { fields: [comments.createdBy], references: [user.id] }),
  agent: one(agentIdentities, {
    fields: [comments.agentIdentityId],
    references: [agentIdentities.id],
  }),
  reactions: many(commentReactions),
}));

export const commentReactionsRelations = relations(
  commentReactions,
  ({ one }) => ({
    comment: one(comments, {
      fields: [commentReactions.commentId],
      references: [comments.id],
    }),
    user: one(user, {
      fields: [commentReactions.userId],
      references: [user.id],
    }),
  }),
);

export const activitiesRelations = relations(activities, ({ one }) => ({
  card: one(cards, { fields: [activities.cardId], references: [cards.id] }),
  user: one(user, { fields: [activities.createdBy], references: [user.id] }),
  agent: one(agentIdentities, {
    fields: [activities.agentIdentityId],
    references: [agentIdentities.id],
  }),
}));

export const agentIdentitiesRelations = relations(
  agentIdentities,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [agentIdentities.workspaceId],
      references: [workspaces.id],
    }),
  }),
);

export const workflowsRelations = relations(workflows, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [workflows.workspaceId],
    references: [workspaces.id],
  }),
  runs: many(workflowRuns),
}));

export const workflowRunsRelations = relations(workflowRuns, ({ one }) => ({
  workflow: one(workflows, {
    fields: [workflowRuns.workflowId],
    references: [workflows.id],
  }),
}));

export const attachmentsRelations = relations(attachments, ({ one }) => ({
  card: one(cards, { fields: [attachments.cardId], references: [cards.id] }),
}));

export const webhooksRelations = relations(webhooks, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [webhooks.workspaceId],
    references: [workspaces.id],
  }),
}));

export const agentJobsRelations = relations(agentJobs, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [agentJobs.workspaceId],
    references: [workspaces.id],
  }),
  author: one(user, { fields: [agentJobs.createdBy], references: [user.id] }),
}));
