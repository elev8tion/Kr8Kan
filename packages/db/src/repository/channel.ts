import { and, desc, eq, isNotNull, isNull, lt } from "drizzle-orm";

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
  const rows = await db.query.channels.findMany({
    where: and(eq(channels.workspaceId, workspaceId), isNull(channels.deletedAt)),
    with: {
      board: { columns: { publicId: true, name: true } },
      // Latest message id/timestamp only — feeds the unread markers.
      messages: {
        columns: { createdAt: true, deletedAt: true },
        orderBy: [desc(messages.id)],
        limit: 5,
      },
    },
    orderBy: (t, { asc }) => [asc(t.name)],
  });
  return rows.map(({ messages: recent, ...channel }) => ({
    ...channel,
    lastMessageAt:
      recent.find((m) => !m.deletedAt)?.createdAt ?? null,
  }));
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

/**
 * Channel activity relevant to a user: @name mentions of them, and
 * replies in threads they participated in. Derived from message rows —
 * no notification tables, the client keeps a local watermark.
 */
export async function listChannelActivityForUser(
  db: Database,
  input: {
    workspaceId: number;
    userId: string;
    userName: string | null;
    limit?: number;
  },
) {
  const rows = await db.query.messages.findMany({
    where: isNull(messages.deletedAt),
    orderBy: [desc(messages.id)],
    limit: 200,
    with: {
      channel: { columns: { publicId: true, name: true, workspaceId: true, deletedAt: true } },
      author: { columns: { id: true, name: true } },
      agent: { columns: { displayName: true, avatar: true } },
      parent: {
        columns: { publicId: true, createdBy: true },
        with: { replies: { columns: { createdBy: true, id: true } } },
      },
    },
  });
  const mention = input.userName
    ? `@${input.userName.toLowerCase()}`
    : null;
  return rows
    .filter((m) => {
      if (m.channel.workspaceId !== input.workspaceId) return false;
      if (m.channel.deletedAt) return false;
      if (m.createdBy === input.userId && !m.agentIdentityId) return false;
      const mentioned = mention
        ? m.body.toLowerCase().includes(mention)
        : false;
      // Thread participation: they authored the root, or an earlier reply.
      const inMyThread =
        m.parent !== null &&
        (m.parent.createdBy === input.userId ||
          m.parent.replies.some(
            (r) => r.createdBy === input.userId && r.id < m.id,
          ));
      return mentioned || inMyThread;
    })
    .slice(0, input.limit ?? 20)
    .map((m) => ({
      at: m.createdAt,
      channelPublicId: m.channel.publicId,
      channelName: m.channel.name,
      messagePublicId: m.publicId,
      threadRootPublicId: m.parent?.publicId ?? null,
      authorName: m.agent
        ? `${m.agent.avatar} ${m.agent.displayName}`
        : (m.author?.name ?? "Someone"),
      snippet: m.body.slice(0, 120),
    }));
}

/* ── trash / restore ───────────────────────────────────────────── */

export async function softDeleteChannel(db: Database, channelId: number) {
  await db
    .update(channels)
    .set({ deletedAt: new Date() })
    .where(eq(channels.id, channelId));
}

/** Soft-deleted channels in a workspace, newest first (30-day display
 * window — display scoping only, nothing is purged). */
export async function listDeletedChannels(
  db: Database,
  workspaceId: number,
  sinceDays = 30,
) {
  const cutoff = new Date(Date.now() - sinceDays * 86_400_000);
  const rows = await db.query.channels.findMany({
    where: and(
      eq(channels.workspaceId, workspaceId),
      isNotNull(channels.deletedAt),
    ),
    orderBy: [desc(channels.deletedAt)],
    limit: 100,
  });
  return rows.filter((c) => c.deletedAt && c.deletedAt >= cutoff);
}

/** Soft-deleted messages in a workspace (channel name attached),
 * newest first. */
export async function listDeletedMessages(
  db: Database,
  workspaceId: number,
  sinceDays = 30,
) {
  const cutoff = new Date(Date.now() - sinceDays * 86_400_000);
  const rows = await db.query.messages.findMany({
    where: isNotNull(messages.deletedAt),
    with: {
      channel: { columns: { publicId: true, name: true, workspaceId: true } },
      author: { columns: { name: true } },
      agent: { columns: { displayName: true } },
    },
    orderBy: [desc(messages.deletedAt)],
    limit: 200,
  });
  return rows
    .filter(
      (m) =>
        m.channel.workspaceId === workspaceId &&
        m.deletedAt &&
        m.deletedAt >= cutoff,
    )
    .slice(0, 100);
}

/** Deleted-inclusive getters — the trash restore path needs to resolve
 * entities the normal getters hide. */
export async function getChannelAnyByPublicId(db: Database, publicId: string) {
  return db.query.channels.findFirst({
    where: eq(channels.publicId, publicId),
  });
}

export async function getMessageAnyByPublicId(db: Database, publicId: string) {
  return db.query.messages.findFirst({
    where: eq(messages.publicId, publicId),
    with: { channel: true },
  });
}

export async function restoreChannel(db: Database, channelId: number) {
  await db
    .update(channels)
    .set({ deletedAt: null })
    .where(eq(channels.id, channelId));
}

/** Restore a message; restores its deleted channel too (parent-chain
 * restore, same shape as card → list → board). */
export async function restoreMessage(db: Database, messageId: number) {
  const message = await db.query.messages.findFirst({
    where: eq(messages.id, messageId),
    with: { channel: true },
  });
  if (!message) return;
  if (message.channel.deletedAt) {
    await restoreChannel(db, message.channelId);
  }
  await db
    .update(messages)
    .set({ deletedAt: null })
    .where(eq(messages.id, messageId));
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
