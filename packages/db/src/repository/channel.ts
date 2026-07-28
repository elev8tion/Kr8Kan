import { generateUID } from "@kr8kan/shared";

import type { Database } from "../client";
import type {
  agentIdentities,
  boards,
  channels,
  messageReactions,
  messages,
  user,
} from "../schema";

export type ChannelRow = typeof channels.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;

type BoardRow = typeof boards.$inferSelect;
type UserRow = typeof user.$inferSelect;
type AgentRow = typeof agentIdentities.$inferSelect;
type ReactionRow = typeof messageReactions.$inferSelect;

/* ── relation helpers ──────────────────────────────────────────── */

const boardLite = (b: BoardRow | undefined) =>
  b ? { publicId: b.publicId, name: b.name } : null;

const authorFull = (u: UserRow | undefined) =>
  u ? { id: u.id, name: u.name, image: u.image } : null;

const agentFull = (a: AgentRow | undefined) =>
  a
    ? { publicId: a.publicId, displayName: a.displayName, avatar: a.avatar }
    : null;

/** Small parallel batch runner — chunk of ~8 concurrent requests, order
 * preserved. Used throughout this file for per-parent / per-id fan-out
 * instead of whole-table reads. */
async function batched<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  chunkSize = 8,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    out.push(...(await Promise.all(chunk.map(worker))));
  }
  return out;
}

/** Users/agents for exactly the ids referenced by `rows` — per-id
 * findFirst/findById batched, instead of whole-table reads. */
async function relationMapsFor(db: Database, rows: MessageRow[]) {
  const userIds = [
    ...new Set(
      rows.map((m) => m.createdBy).filter((id): id is string => id != null),
    ),
  ];
  const agentIds = [
    ...new Set(
      rows
        .map((m) => m.agentIdentityId)
        .filter((id): id is number => id != null),
    ),
  ];
  const [userRows, agentRows] = await Promise.all([
    batched(
      userIds,
      (id) => db.findFirst("user", { where: { id } }) as Promise<UserRow | undefined>,
    ),
    // agentIdentities is soft-delete; findById is deleted-inclusive by
    // construction, matching the prior includeDeleted:true whole-table read.
    batched(agentIds, (id) => db.findById("agentIdentities", id)),
  ]);
  const usersById = new Map<string, UserRow>();
  userRows.forEach((u, i) => {
    if (u) usersById.set(userIds[i]!, u);
  });
  const agentsById = new Map<number, AgentRow>();
  agentRows.forEach((a, i) => {
    if (a) agentsById.set(agentIds[i]!, a as AgentRow);
  });
  return { usersById, agentsById };
}

/** Attach the standard `messageWith` relations (author/agent/reactions).
 * Root/thread message sets are always small (paged / one thread), so
 * per-message reaction fetches stay cheap. */
async function withMessageRelations(db: Database, rows: MessageRow[]) {
  const [{ usersById, agentsById }, reactionsPerMessage] = await Promise.all([
    relationMapsFor(db, rows),
    batched(
      rows,
      (m) =>
        db.findMany("messageReactions", {
          where: { messageId: m.id },
        }) as Promise<ReactionRow[]>,
    ),
  ]);
  return rows.map((m, i) => ({
    ...m,
    author: authorFull(m.createdBy ? usersById.get(m.createdBy) : undefined),
    agent: agentFull(
      m.agentIdentityId !== null ? agentsById.get(m.agentIdentityId) : undefined,
    ),
    reactions: [...reactionsPerMessage[i]!]
      .sort((a, b) => a.id - b.id)
      .map((r) => ({ emoji: r.emoji, userId: r.userId })),
  }));
}

/* ── channels ──────────────────────────────────────────────────── */

export async function listChannels(db: Database, workspaceId: number) {
  const rows = (await db.findMany("channels", {
    where: { workspaceId },
    orderBy: { field: "name" },
  })) as ChannelRow[];
  // Only the boards actually referenced by these channels, deleted-
  // inclusive (findById is inherently deleted-inclusive, matching the
  // prior includeDeleted:true whole-table read).
  const boardIds = [
    ...new Set(
      rows.map((c) => c.boardId).filter((id): id is number => id != null),
    ),
  ];
  const boardRows = await batched(boardIds, (id) => db.findById("boards", id));
  const boardsById = new Map<number, BoardRow>();
  boardRows.forEach((b, i) => {
    if (b) boardsById.set(boardIds[i]!, b as BoardRow);
  });
  // Per-channel: newest 5 messages by id (server sort+limit), instead of
  // loading every message in the instance to find each channel's latest.
  const recentPerChannel = await batched(
    rows,
    (channel) =>
      db.findMany("messages", {
        where: { channelId: channel.id },
        orderBy: { field: "id", dir: "desc" },
        serverLimit: 5,
        includeDeleted: true,
      }) as Promise<MessageRow[]>,
  );
  return rows.map((channel, i) => {
    const recent = recentPerChannel[i]!;
    return {
      ...channel,
      board:
        channel.boardId !== null
          ? boardLite(boardsById.get(channel.boardId))
          : null,
      lastMessageAt: recent.find((m) => !m.deletedAt)?.createdAt ?? null,
    };
  });
}

export async function getChannelByPublicId(db: Database, publicId: string) {
  const channel = (await db.findFirst("channels", { where: { publicId } })) as
    | ChannelRow
    | undefined;
  if (!channel) return undefined;
  const board =
    channel.boardId !== null
      ? ((await db.findFirst("boards", {
          where: { id: channel.boardId },
          includeDeleted: true,
        })) as BoardRow | undefined)
      : undefined;
  return { ...channel, board: boardLite(board) };
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
  const channel = (await db.insert("channels", {
    publicId: generateUID(),
    workspaceId: input.workspaceId,
    name: input.name,
    slug: input.slug,
    topic: input.topic,
    boardId: input.boardId,
    createdBy: input.userId,
  })) as ChannelRow | undefined;
  if (channel) {
    await db.insert("channelMembers", {
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
  return (await db.update("channels", channelId, {
    ...patch,
    updatedAt: new Date(),
  })) as ChannelRow | undefined;
}

export async function setChannelArchived(
  db: Database,
  channelId: number,
  archived: boolean,
) {
  return (await db.update("channels", channelId, {
    archivedAt: archived ? new Date() : null,
    updatedAt: new Date(),
  })) as ChannelRow | undefined;
}

/* ── messages ──────────────────────────────────────────────────── */

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
  const all = (await db.findMany("messages", {
    where: { channelId },
    includeDeleted: true,
  })) as MessageRow[];
  const roots = all
    .filter(
      (m) =>
        m.parentMessageId === null &&
        m.deletedAt === null &&
        (opts.cursor ? m.id < opts.cursor : true),
    )
    .sort((a, b) => b.id - a.id)
    .slice(0, opts.limit);
  // replies ride along deleted-or-not (drizzle `with:` did not filter)
  const repliesByParent = new Map<
    number,
    { id: number; deletedAt: Date | null }[]
  >();
  for (const m of [...all].sort((a, b) => a.id - b.id)) {
    if (m.parentMessageId === null) continue;
    const list = repliesByParent.get(m.parentMessageId) ?? [];
    list.push({ id: m.id, deletedAt: m.deletedAt });
    repliesByParent.set(m.parentMessageId, list);
  }
  const withRelations = await withMessageRelations(db, roots);
  return withRelations.map((m) => ({
    ...m,
    replies: repliesByParent.get(m.id) ?? [],
  }));
}

export async function getThread(db: Database, rootMessageId: number) {
  const rows = (await db.findMany("messages", {
    where: { parentMessageId: rootMessageId },
    orderBy: { field: "id" },
  })) as MessageRow[];
  return withMessageRelations(db, rows);
}

export async function getMessageByPublicId(db: Database, publicId: string) {
  const message = (await db.findFirst("messages", { where: { publicId } })) as
    | MessageRow
    | undefined;
  if (!message) return undefined;
  const channel = (await db.findFirst("channels", {
    where: { id: message.channelId },
    includeDeleted: true,
  })) as ChannelRow | undefined;
  if (!channel) return undefined;
  return { ...message, channel };
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
  return (await db.insert("messages", {
    publicId: generateUID(),
    channelId: input.channelId,
    body: input.body,
    parentMessageId: input.parentMessageId,
    createdBy: input.userId,
    agentIdentityId: input.agentIdentityId,
  })) as MessageRow | undefined;
}

export async function updateMessage(
  db: Database,
  messageId: number,
  body: string,
) {
  const now = new Date();
  return (await db.update("messages", messageId, {
    body,
    editedAt: now,
    updatedAt: now,
  })) as MessageRow | undefined;
}

export async function softDeleteMessage(db: Database, messageId: number) {
  await db.update("messages", messageId, { deletedAt: new Date() });
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
  const rows = (await db.findMany("messages", {
    where: { channelId },
    orderBy: { field: "id", dir: "desc" },
    limit,
  })) as MessageRow[];
  const { usersById, agentsById } = await relationMapsFor(db, rows);
  return rows.map((m) => {
    const author = m.createdBy ? usersById.get(m.createdBy) : undefined;
    const agent =
      m.agentIdentityId !== null ? agentsById.get(m.agentIdentityId) : undefined;
    return {
      ...m,
      author: author ? { name: author.name } : null,
      agent: agent ? { displayName: agent.displayName } : null,
    };
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
    userEmail?: string | null;
    limit?: number;
  },
) {
  const all = (await db.findMany("messages", {
    includeDeleted: true,
  })) as MessageRow[];
  const byId = new Map(all.map((m) => [m.id, m]));
  const repliesByParent = new Map<number, MessageRow[]>();
  for (const m of all) {
    if (m.parentMessageId === null) continue;
    const list = repliesByParent.get(m.parentMessageId) ?? [];
    list.push(m);
    repliesByParent.set(m.parentMessageId, list);
  }
  const allChannels = (await db.findMany("channels", {
    includeDeleted: true,
  })) as ChannelRow[];
  const channelsById = new Map(allChannels.map((c) => [c.id, c]));

  const windowed = all
    .filter((m) => m.deletedAt === null && channelsById.has(m.channelId))
    .sort((a, b) => b.id - a.id)
    .slice(0, 200);
  const { usersById, agentsById } = await relationMapsFor(db, windowed);

  const rows = windowed
    .map((m) => {
      const channel = channelsById.get(m.channelId)!;
      const author = m.createdBy ? usersById.get(m.createdBy) : undefined;
      const agent =
        m.agentIdentityId !== null
          ? agentsById.get(m.agentIdentityId)
          : undefined;
      const parentRow =
        m.parentMessageId !== null ? byId.get(m.parentMessageId) : undefined;
      return {
        ...m,
        channel: {
          publicId: channel.publicId,
          name: channel.name,
          workspaceId: channel.workspaceId,
          deletedAt: channel.deletedAt,
        },
        author: author ? { id: author.id, name: author.name } : null,
        agent: agent
          ? { displayName: agent.displayName, avatar: agent.avatar }
          : null,
        parent: parentRow
          ? {
              publicId: parentRow.publicId,
              createdBy: parentRow.createdBy,
              replies: (repliesByParent.get(parentRow.id) ?? []).map((r) => ({
                createdBy: r.createdBy,
                id: r.id,
              })),
            }
          : null,
      };
    });

  // Magic-link accounts start with name "" — fall back to the email
  // local-part so every account has a stable @handle before a display
  // name is set. Never match a bare "@" (it would flag every message).
  const handle =
    input.userName?.trim() || input.userEmail?.split("@")[0]?.trim() || null;
  const mention = handle ? `@${handle.toLowerCase()}` : null;
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
  await db.update("channels", channelId, { deletedAt: new Date() });
}

/** Soft-deleted channels in a workspace, newest first (30-day display
 * window — display scoping only, nothing is purged). */
export async function listDeletedChannels(
  db: Database,
  workspaceId: number,
  sinceDays = 30,
) {
  const cutoff = new Date(Date.now() - sinceDays * 86_400_000);
  const rows = (await db.findMany("channels", {
    where: { workspaceId },
    onlyDeleted: true,
    orderBy: { field: "deletedAt", dir: "desc" },
    limit: 100,
  })) as ChannelRow[];
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
  const deleted = (await db.findMany("messages", {
    onlyDeleted: true,
    orderBy: { field: "deletedAt", dir: "desc" },
    limit: 200,
  })) as MessageRow[];
  const allChannels = (await db.findMany("channels", {
    includeDeleted: true,
  })) as ChannelRow[];
  const channelsById = new Map(allChannels.map((c) => [c.id, c]));
  const { usersById, agentsById } = await relationMapsFor(db, deleted);
  return deleted
    .filter((m) => channelsById.has(m.channelId))
    .map((m) => {
      const channel = channelsById.get(m.channelId)!;
      const author = m.createdBy ? usersById.get(m.createdBy) : undefined;
      const agent =
        m.agentIdentityId !== null
          ? agentsById.get(m.agentIdentityId)
          : undefined;
      return {
        ...m,
        channel: {
          publicId: channel.publicId,
          name: channel.name,
          workspaceId: channel.workspaceId,
        },
        author: author ? { name: author.name } : null,
        agent: agent ? { displayName: agent.displayName } : null,
      };
    })
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
  return (await db.findFirst("channels", {
    where: { publicId },
    includeDeleted: true,
  })) as ChannelRow | undefined;
}

export async function getMessageAnyByPublicId(db: Database, publicId: string) {
  const message = (await db.findFirst("messages", {
    where: { publicId },
    includeDeleted: true,
  })) as MessageRow | undefined;
  if (!message) return undefined;
  const channel = (await db.findFirst("channels", {
    where: { id: message.channelId },
    includeDeleted: true,
  })) as ChannelRow | undefined;
  if (!channel) return undefined;
  return { ...message, channel };
}

export async function restoreChannel(db: Database, channelId: number) {
  await db.update("channels", channelId, { deletedAt: null });
}

/** Restore a message; restores its deleted channel too (parent-chain
 * restore, same shape as card → list → board). */
export async function restoreMessage(db: Database, messageId: number) {
  const message = (await db.findFirst("messages", {
    where: { id: messageId },
    includeDeleted: true,
  })) as MessageRow | undefined;
  if (!message) return;
  const channel = (await db.findFirst("channels", {
    where: { id: message.channelId },
    includeDeleted: true,
  })) as ChannelRow | undefined;
  if (channel?.deletedAt) {
    await restoreChannel(db, message.channelId);
  }
  await db.update("messages", messageId, { deletedAt: null });
}

/* ── reactions ─────────────────────────────────────────────────── */

export async function addMessageReaction(
  db: Database,
  input: { messageId: number; emoji: string; userId: string },
) {
  const { row, created } = await db.insertIfAbsent("messageReactions", input, [
    "messageId",
    "emoji",
    "userId",
  ]);
  return created ? (row as ReactionRow) : null;
}

export async function removeMessageReaction(
  db: Database,
  input: { messageId: number; emoji: string; userId: string },
) {
  await db.hardDeleteWhere("messageReactions", {
    messageId: input.messageId,
    emoji: input.emoji,
    userId: input.userId,
  });
}
