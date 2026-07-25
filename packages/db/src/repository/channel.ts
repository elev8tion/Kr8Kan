import { and, desc, eq, isNull, lt } from "drizzle-orm";

import { generateUID } from "@kr8kan/shared";

import type { Database } from "../client";
import {
  channelMembers,
  channels,
  messageReactions,
  messages,
} from "../schema";

export type ChannelRow = typeof channels.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;

/* ── channels ──────────────────────────────────────────────────── */

export async function listChannels(db: Database, workspaceId: number) {
  return db.query.channels.findMany({
    where: and(eq(channels.workspaceId, workspaceId), isNull(channels.deletedAt)),
    with: { board: { columns: { publicId: true, name: true } } },
    orderBy: (t, { asc }) => [asc(t.name)],
  });
}

export async function getChannelByPublicId(db: Database, publicId: string) {
  return db.query.channels.findFirst({
    where: and(eq(channels.publicId, publicId), isNull(channels.deletedAt)),
    with: { board: { columns: { publicId: true, name: true } } },
  });
}

export async function createChannel(
  db: Database,
  input: {
    workspaceId: number;
    name: string;
    slug: string;
    topic?: string;
    boardId?: number;
    userId: string;
  },
) {
  const [channel] = await db
    .insert(channels)
    .values({
      publicId: generateUID(),
      workspaceId: input.workspaceId,
      name: input.name,
      slug: input.slug,
      topic: input.topic,
      boardId: input.boardId,
      createdBy: input.userId,
    })
    .returning();
  if (channel) {
    await db.insert(channelMembers).values({
      publicId: generateUID(),
      channelId: channel.id,
      userId: input.userId,
    });
  }
  return channel;
}

export async function updateChannel(
  db: Database,
  channelId: number,
  patch: { name?: string; slug?: string; topic?: string | null },
) {
  const [updated] = await db
    .update(channels)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(channels.id, channelId))
    .returning();
  return updated;
}

export async function setChannelArchived(
  db: Database,
  channelId: number,
  archived: boolean,
) {
  const [updated] = await db
    .update(channels)
    .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
    .where(eq(channels.id, channelId))
    .returning();
  return updated;
}

/* ── messages ──────────────────────────────────────────────────── */

const messageWith = {
  author: {
    columns: { id: true, name: true, image: true },
  },
  agent: {
    columns: { publicId: true, displayName: true, avatar: true },
  },
  reactions: {
    columns: { emoji: true, userId: true },
  },
} as const;

/**
 * Root messages (thread starters), newest-first page by id cursor.
 * Callers reverse for display (oldest at top, newest at bottom).
 * Reply bodies load via getThread; only ids ride along here for counts.
 */
export async function listRootMessages(
  db: Database,
  channelId: number,
  opts: { limit: number; cursor?: number },
) {
  return db.query.messages.findMany({
    where: and(
      eq(messages.channelId, channelId),
      isNull(messages.parentMessageId),
      isNull(messages.deletedAt),
      opts.cursor ? lt(messages.id, opts.cursor) : undefined,
    ),
    with: {
      ...messageWith,
      replies: { columns: { id: true, deletedAt: true } },
    },
    orderBy: [desc(messages.id)],
    limit: opts.limit,
  });
}

export async function getThread(db: Database, rootMessageId: number) {
  return db.query.messages.findMany({
    where: and(
      eq(messages.parentMessageId, rootMessageId),
      isNull(messages.deletedAt),
    ),
    with: messageWith,
    orderBy: (t, { asc }) => [asc(t.id)],
  });
}

export async function getMessageByPublicId(db: Database, publicId: string) {
  return db.query.messages.findFirst({
    where: and(eq(messages.publicId, publicId), isNull(messages.deletedAt)),
    with: { channel: true },
  });
}

export async function addMessage(
  db: Database,
  input: {
    channelId: number;
    body: string;
    userId: string;
    /** Pre-resolved thread ROOT id (see resolveThreadRootId in the API). */
    parentMessageId?: number;
    /** Set when an agent authored the message (userId = operator). */
    agentIdentityId?: number;
  },
) {
  const [created] = await db
    .insert(messages)
    .values({
      publicId: generateUID(),
      channelId: input.channelId,
      body: input.body,
      parentMessageId: input.parentMessageId,
      createdBy: input.userId,
      agentIdentityId: input.agentIdentityId,
    })
    .returning();
  return created;
}

export async function updateMessage(
  db: Database,
  messageId: number,
  body: string,
) {
  const now = new Date();
  const [updated] = await db
    .update(messages)
    .set({ body, editedAt: now, updatedAt: now })
    .where(eq(messages.id, messageId))
    .returning();
  return updated;
}

export async function softDeleteMessage(db: Database, messageId: number) {
  await db
    .update(messages)
    .set({ deletedAt: new Date() })
    .where(eq(messages.id, messageId));
}

/**
 * Most recent messages in a channel (roots and replies interleaved),
 * newest-first — bounded raw material for worker channel context.
 * Callers reverse for chronological reading.
 */
export async function listRecentMessages(
  db: Database,
  channelId: number,
  limit: number,
) {
  return db.query.messages.findMany({
    where: and(eq(messages.channelId, channelId), isNull(messages.deletedAt)),
    with: {
      author: { columns: { name: true } },
      agent: { columns: { displayName: true } },
    },
    orderBy: [desc(messages.id)],
    limit,
  });
}

/* ── reactions ─────────────────────────────────────────────────── */

export async function addMessageReaction(
  db: Database,
  input: { messageId: number; emoji: string; userId: string },
) {
  const [row] = await db
    .insert(messageReactions)
    .values(input)
    .onConflictDoNothing()
    .returning();
  return row ?? null;
}

export async function removeMessageReaction(
  db: Database,
  input: { messageId: number; emoji: string; userId: string },
) {
  await db
    .delete(messageReactions)
    .where(
      and(
        eq(messageReactions.messageId, input.messageId),
        eq(messageReactions.emoji, input.emoji),
        eq(messageReactions.userId, input.userId),
      ),
    );
}
