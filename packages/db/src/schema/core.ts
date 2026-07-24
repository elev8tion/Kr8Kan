import { relations } from "drizzle-orm";
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
}));

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

export const commentsRelations = relations(comments, ({ one }) => ({
  card: one(cards, { fields: [comments.cardId], references: [cards.id] }),
  author: one(user, { fields: [comments.createdBy], references: [user.id] }),
}));

export const activitiesRelations = relations(activities, ({ one }) => ({
  card: one(cards, { fields: [activities.cardId], references: [cards.id] }),
  user: one(user, { fields: [activities.createdBy], references: [user.id] }),
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
