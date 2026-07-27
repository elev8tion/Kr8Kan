import { computeMove, generateUID } from "@kr8kan/shared";

import type { Database } from "../client";
import {
  activities,
  agentIdentities,
  attachments,
  boards,
  cardLabels,
  cardMembers,
  cards,
  checklistItems,
  checklists,
  commentReactions,
  comments,
  labels,
  lists,
  user,
  workspaceMembers,
  workspaces,
} from "../schema";

type CardRow = typeof cards.$inferSelect;
type ListRow = typeof lists.$inferSelect;
type BoardRow = typeof boards.$inferSelect;
type WorkspaceRow = typeof workspaces.$inferSelect;
type LabelRow = typeof labels.$inferSelect;
type CardLabelRow = typeof cardLabels.$inferSelect;
type CardMemberRow = typeof cardMembers.$inferSelect;
type WorkspaceMemberRow = typeof workspaceMembers.$inferSelect;
type ChecklistRow = typeof checklists.$inferSelect;
type ChecklistItemRow = typeof checklistItems.$inferSelect;
type CommentRow = typeof comments.$inferSelect;
type CommentReactionRow = typeof commentReactions.$inferSelect;
type ActivityRow = typeof activities.$inferSelect;
type AttachmentRow = typeof attachments.$inferSelect;
type UserRow = typeof user.$inferSelect;
type AgentRow = typeof agentIdentities.$inferSelect;

/* ── nested lookup helpers ─────────────────────────────────────── */

async function getListWithBoard(
  db: Database,
  listId: number,
): Promise<ListRow & { board: BoardRow }> {
  const list = (await db.findById("lists", listId)) as ListRow | undefined;
  if (!list) throw new Error(`list ${listId} not found`);
  const board = (await db.findById("boards", list.boardId)) as
    | BoardRow
    | undefined;
  if (!board) throw new Error(`board ${list.boardId} not found`);
  return { ...list, board };
}

async function usersById(db: Database): Promise<Map<string, UserRow>> {
  const rows = (await db.findMany("user")) as UserRow[];
  return new Map(rows.map((u) => [u.id, u]));
}

async function agentsById(db: Database): Promise<Map<number, AgentRow>> {
  const rows = (await db.findMany("agentIdentities", {
    includeDeleted: true,
  })) as AgentRow[];
  return new Map(rows.map((a) => [a.id, a]));
}

export async function createCard(
  db: Database,
  input: {
    listId: number;
    title: string;
    description?: string;
    userId: string;
  },
) {
  return db.transaction(async (tx) => {
    const siblings = await tx.findMany("cards", {
      where: { listId: input.listId },
    });
    const card = (await tx.insert("cards", {
      publicId: generateUID(),
      listId: input.listId,
      title: input.title,
      description: input.description,
      index: siblings.length,
      createdBy: input.userId,
    })) as CardRow;
    await tx.insert("activities", {
      publicId: generateUID(),
      cardId: card.id,
      type: "card.created",
      createdBy: input.userId,
    });
    return card;
  });
}

export async function getCardByPublicId(db: Database, publicId: string) {
  const card = (await db.findFirst("cards", { where: { publicId } })) as
    | CardRow
    | undefined;
  if (!card) return undefined;

  const list = await getListWithBoard(db, card.listId);
  const workspace = (await db.findById(
    "workspaces",
    list.board.workspaceId,
  )) as WorkspaceRow | undefined;
  if (!workspace) throw new Error(`workspace ${list.board.workspaceId} not found`);

  const [
    cardLabelRows,
    cardMemberRows,
    checklistRows,
    commentRows,
    activityRows,
    attachmentRows,
    userMap,
    agentMap,
  ] = await Promise.all([
    db.findMany("cardLabels", { where: { cardId: card.id } }) as Promise<
      CardLabelRow[]
    >,
    db.findMany("cardMembers", { where: { cardId: card.id } }) as Promise<
      CardMemberRow[]
    >,
    db.findMany("checklists", {
      where: { cardId: card.id },
      orderBy: { field: "index" },
    }) as Promise<ChecklistRow[]>,
    db.findMany("comments", {
      where: { cardId: card.id },
      orderBy: { field: "createdAt" },
    }) as Promise<CommentRow[]>,
    db.findMany("activities", {
      where: { cardId: card.id },
      orderBy: { field: "createdAt", dir: "desc" },
    }) as Promise<ActivityRow[]>,
    db.findMany("attachments", {
      where: { cardId: card.id },
      includeDeleted: true,
    }) as Promise<AttachmentRow[]>,
    usersById(db),
    agentsById(db),
  ]);

  // labels — board-scoped fetch (includes deleted, matching drizzle `with`)
  const labelRows = (await db.findMany("labels", {
    where: { boardId: list.boardId },
    includeDeleted: true,
  })) as LabelRow[];
  const labelMap = new Map(labelRows.map((l) => [l.id, l]));
  const cardLabelsOut = cardLabelRows.map((cl) => ({
    ...cl,
    label: labelMap.get(cl.labelId) as LabelRow,
  }));

  // members — workspace_member + user
  const memberRows = (await db.findMany("workspaceMembers", {
    includeDeleted: true,
  })) as WorkspaceMemberRow[];
  const memberMap = new Map(memberRows.map((m) => [m.id, m]));
  const membersOut = cardMemberRows.map((cm) => {
    const member = memberMap.get(cm.memberId) as WorkspaceMemberRow;
    return {
      ...cm,
      member: { ...member, user: userMap.get(member.userId) as UserRow },
    };
  });

  // checklists + items (not-deleted, index asc — handled by findMany)
  const itemRows = (await db.findMany("checklistItems", {
    orderBy: { field: "index" },
  })) as ChecklistItemRow[];
  const itemsByChecklist = new Map<number, ChecklistItemRow[]>();
  for (const item of itemRows) {
    const bucket = itemsByChecklist.get(item.checklistId);
    if (bucket) bucket.push(item);
    else itemsByChecklist.set(item.checklistId, [item]);
  }
  const checklistsOut = checklistRows.map((cl) => ({
    ...cl,
    items: itemsByChecklist.get(cl.id) ?? [],
  }));

  // comments + author/agent/reactions
  const reactionRows = (await db.findMany("commentReactions", {
    orderBy: { field: "createdAt" },
  })) as CommentReactionRow[];
  const reactionsByComment = new Map<
    number,
    (CommentReactionRow & { user: UserRow })[]
  >();
  for (const r of reactionRows) {
    const withUser = { ...r, user: userMap.get(r.userId) as UserRow };
    const bucket = reactionsByComment.get(r.commentId);
    if (bucket) bucket.push(withUser);
    else reactionsByComment.set(r.commentId, [withUser]);
  }
  const commentsOut = commentRows.map((c) => ({
    ...c,
    author: (c.createdBy && userMap.get(c.createdBy)) || null,
    agent:
      (c.agentIdentityId != null && agentMap.get(c.agentIdentityId)) || null,
    reactions: reactionsByComment.get(c.id) ?? [],
  }));

  // activities + user/agent
  const activitiesOut = activityRows.map((a) => ({
    ...a,
    user: (a.createdBy && userMap.get(a.createdBy)) || null,
    agent:
      (a.agentIdentityId != null && agentMap.get(a.agentIdentityId)) || null,
  }));

  return {
    ...card,
    list: { ...list, board: { ...list.board, workspace } },
    labels: cardLabelsOut,
    members: membersOut,
    checklists: checklistsOut,
    comments: commentsOut,
    activities: activitiesOut,
    attachments: attachmentRows,
  };
}

export async function updateCard(
  db: Database,
  cardId: number,
  input: {
    title?: string;
    description?: string | null;
    dueDate?: Date | null;
  },
  userId?: string,
) {
  const updated = (await db.update("cards", cardId, {
    ...input,
    updatedAt: new Date(),
  })) as CardRow | undefined;
  if (updated && userId) {
    await recordActivity(db, {
      cardId,
      type: "card.updated",
      userId,
      metadata: { fields: Object.keys(input) },
    });
  }
  return updated;
}

/**
 * Move a card to `toListId` at `position`. Renumbers source and target
 * lists densely (see @kr8kan/shared computeMove) — sequential updates,
 * NCB has no transactions.
 */
export async function moveCard(
  db: Database,
  input: {
    cardId: number;
    toListId: number;
    position: number;
    userId: string;
  },
) {
  return db.transaction(async (tx) => {
    const card = (await tx.findFirst("cards", {
      where: { id: input.cardId },
      includeDeleted: true,
    })) as CardRow | undefined;
    if (!card) throw new Error("card not found");

    const sourceCards = (await tx.findMany("cards", {
      where: { listId: card.listId },
      orderBy: { field: "index" },
    })) as CardRow[];

    const sameList = card.listId === input.toListId;
    const targetCards = sameList
      ? undefined
      : ((await tx.findMany("cards", {
          where: { listId: input.toListId },
          orderBy: { field: "index" },
        })) as CardRow[]);

    const { source, target } = computeMove({
      source: sourceCards,
      target: targetCards,
      id: card.id,
      position: input.position,
    });

    for (const row of source) {
      await tx.update("cards", row.id, { index: row.index });
    }
    for (const row of target) {
      await tx.update("cards", row.id, {
        index: row.index,
        listId: input.toListId,
      });
    }
    if (!sameList) {
      await tx.update("cards", card.id, { listId: input.toListId });
      await tx.insert("activities", {
        publicId: generateUID(),
        cardId: card.id,
        type: "card.moved",
        createdBy: input.userId,
        metadata: { fromListId: card.listId, toListId: input.toListId },
      });
    }
    return { ...card, listId: input.toListId };
  });
}

export async function softDeleteCard(db: Database, cardId: number) {
  await db.softDelete("cards", cardId);
}

/* ── labels / members ──────────────────────────────────────────── */

export async function addLabelToCard(
  db: Database,
  cardId: number,
  labelId: number,
  userId: string,
) {
  await db.insertIfAbsent("cardLabels", { cardId, labelId }, [
    "cardId",
    "labelId",
  ]);
  await recordActivity(db, {
    cardId,
    type: "card.label.added",
    userId,
    metadata: { labelId },
  });
}

export async function removeLabelFromCard(
  db: Database,
  cardId: number,
  labelId: number,
) {
  await db.hardDeleteWhere("cardLabels", { cardId, labelId });
}

export async function addMemberToCard(
  db: Database,
  cardId: number,
  memberId: number,
  userId: string,
) {
  await db.insertIfAbsent("cardMembers", { cardId, memberId }, [
    "cardId",
    "memberId",
  ]);
  await recordActivity(db, {
    cardId,
    type: "card.member.added",
    userId,
    metadata: { memberId },
  });
}

export async function removeMemberFromCard(
  db: Database,
  cardId: number,
  memberId: number,
) {
  await db.hardDeleteWhere("cardMembers", { cardId, memberId });
}

/* ── comments ──────────────────────────────────────────────────── */

export async function addComment(
  db: Database,
  input: {
    cardId: number;
    comment: string;
    userId: string;
    /** Set when an agent authored the comment (userId = operator). */
    agentIdentityId?: number;
  },
) {
  const created = (await db.insert("comments", {
    publicId: generateUID(),
    cardId: input.cardId,
    comment: input.comment,
    createdBy: input.userId,
    agentIdentityId: input.agentIdentityId,
  })) as CommentRow;
  await recordActivity(db, {
    cardId: input.cardId,
    type: "card.comment.created",
    userId: input.userId,
    agentIdentityId: input.agentIdentityId,
  });
  return created;
}

export async function getCommentByPublicId(db: Database, publicId: string) {
  const comment = (await db.findFirst("comments", { where: { publicId } })) as
    | CommentRow
    | undefined;
  if (!comment) return undefined;
  const card = (await db.findById("cards", comment.cardId)) as CardRow;
  const list = await getListWithBoard(db, card.listId);
  return { ...comment, card: { ...card, list } };
}

export async function updateComment(
  db: Database,
  commentId: number,
  text: string,
) {
  const updated = (await db.update("comments", commentId, {
    comment: text,
    updatedAt: new Date(),
  })) as CommentRow | undefined;
  return updated;
}

export async function softDeleteComment(db: Database, commentId: number) {
  await db.softDelete("comments", commentId);
}

/* ── checklists ────────────────────────────────────────────────── */

export async function createChecklist(
  db: Database,
  input: { cardId: number; name: string },
) {
  const existing = await db.findMany("checklists", {
    where: { cardId: input.cardId },
  });
  const checklist = (await db.insert("checklists", {
    publicId: generateUID(),
    cardId: input.cardId,
    name: input.name,
    index: existing.length,
  })) as ChecklistRow;
  return checklist;
}

export async function getChecklistByPublicId(db: Database, publicId: string) {
  const checklist = (await db.findFirst("checklists", {
    where: { publicId },
  })) as ChecklistRow | undefined;
  if (!checklist) return undefined;
  const card = (await db.findById("cards", checklist.cardId)) as CardRow;
  return { ...checklist, card };
}

export async function softDeleteChecklist(db: Database, checklistId: number) {
  await db.softDelete("checklists", checklistId);
}

export async function addChecklistItem(
  db: Database,
  input: { checklistId: number; title: string },
) {
  const existing = await db.findMany("checklistItems", {
    where: { checklistId: input.checklistId },
  });
  const item = (await db.insert("checklistItems", {
    publicId: generateUID(),
    checklistId: input.checklistId,
    title: input.title,
    index: existing.length,
  })) as ChecklistItemRow;
  return item;
}

export async function getChecklistItemByPublicId(
  db: Database,
  publicId: string,
) {
  const item = (await db.findFirst("checklistItems", {
    where: { publicId },
  })) as ChecklistItemRow | undefined;
  if (!item) return undefined;
  const checklist = (await db.findById(
    "checklists",
    item.checklistId,
  )) as ChecklistRow;
  const card = (await db.findById("cards", checklist.cardId)) as CardRow;
  return { ...item, checklist: { ...checklist, card } };
}

export async function updateChecklistItem(
  db: Database,
  itemId: number,
  input: { title?: string; completed?: boolean },
) {
  const updated = (await db.update("checklistItems", itemId, input)) as
    | ChecklistItemRow
    | undefined;
  return updated;
}

export async function softDeleteChecklistItem(db: Database, itemId: number) {
  await db.softDelete("checklistItems", itemId);
}

/* ── attachments ───────────────────────────────────────────────── */

export async function createAttachment(
  db: Database,
  input: {
    cardId: number;
    filename: string;
    key: string;
    contentType?: string;
    size?: number;
    userId: string;
  },
) {
  const row = (await db.insert("attachments", {
    publicId: generateUID(),
    cardId: input.cardId,
    filename: input.filename,
    key: input.key,
    contentType: input.contentType,
    size: input.size,
    createdBy: input.userId,
  })) as AttachmentRow;
  return row;
}

export async function getAttachmentByPublicId(db: Database, publicId: string) {
  const attachment = (await db.findFirst("attachments", {
    where: { publicId },
  })) as AttachmentRow | undefined;
  if (!attachment) return undefined;
  const card = (await db.findById("cards", attachment.cardId)) as CardRow;
  const list = await getListWithBoard(db, card.listId);
  return { ...attachment, card: { ...card, list } };
}

export async function softDeleteAttachment(db: Database, attachmentId: number) {
  await db.softDelete("attachments", attachmentId);
}

/* ── reactions ─────────────────────────────────────────────────── */

export async function addReaction(
  db: Database,
  input: { commentId: number; emoji: string; userId: string },
) {
  const { row, created } = await db.insertIfAbsent(
    "commentReactions",
    input,
    ["commentId", "emoji", "userId"],
  );
  return created ? (row as CommentReactionRow) : null;
}

export async function removeReaction(
  db: Database,
  input: { commentId: number; emoji: string; userId: string },
) {
  await db.hardDeleteWhere("commentReactions", {
    commentId: input.commentId,
    emoji: input.emoji,
    userId: input.userId,
  });
}

/* ── activity ──────────────────────────────────────────────────── */

export async function recordActivity(
  db: Database,
  input: {
    cardId: number;
    type: string;
    userId: string;
    /** Set when an agent performed the action (userId = operator). */
    agentIdentityId?: number;
    metadata?: Record<string, unknown>;
  },
) {
  await db.insert("activities", {
    publicId: generateUID(),
    cardId: input.cardId,
    type: input.type,
    createdBy: input.userId,
    agentIdentityId: input.agentIdentityId,
    metadata: input.metadata,
  });
}

/** Board-scoped card lookup helper used by permission checks. */
export async function getCardWithBoard(db: Database, cardPublicId: string) {
  const card = (await db.findFirst("cards", {
    where: { publicId: cardPublicId },
  })) as CardRow | undefined;
  if (!card) return undefined;
  const list = await getListWithBoard(db, card.listId);
  const workspace = (await db.findById(
    "workspaces",
    list.board.workspaceId,
  )) as WorkspaceRow;
  return {
    ...card,
    list: { ...list, board: { ...list.board, workspace } },
  };
}

/** All lists with their boards attached, keyed by list id (shared by the
 * JS-filtered listing helpers below — one fetch each per call). */
async function listBoardIndex(db: Database) {
  const [listRows, boardRows] = await Promise.all([
    db.findMany("lists", { includeDeleted: true }) as Promise<ListRow[]>,
    db.findMany("boards", { includeDeleted: true }) as Promise<BoardRow[]>,
  ]);
  const boardMap = new Map(boardRows.map((b) => [b.id, b]));
  const byListId = new Map<number, ListRow & { board: BoardRow }>();
  for (const l of listRows) {
    const board = boardMap.get(l.boardId);
    if (board) byListId.set(l.id, { ...l, board });
  }
  return byListId;
}

/** Cards in a workspace (optionally one board) due within `hours` from
 * now — the card.due trigger's scan set. */
export async function listCardsDueWithin(
  db: Database,
  input: { workspaceId: number; boardPublicId?: string; hours: number },
) {
  const now = new Date();
  const until = new Date(now.getTime() + input.hours * 3600_000);
  const cardRows = (await db.findMany("cards")) as CardRow[];
  const listIndex = await listBoardIndex(db);
  return cardRows
    .filter(
      (c) => c.dueDate !== null && c.dueDate > now && c.dueDate <= until,
    )
    .map((c) => ({
      publicId: c.publicId,
      title: c.title,
      dueDate: c.dueDate,
      list: listIndex.get(c.listId) as ListRow & { board: BoardRow },
    }))
    .filter(
      (c) =>
        c.list.board.workspaceId === input.workspaceId &&
        !c.list.board.deletedAt &&
        (!input.boardPublicId || c.list.board.publicId === input.boardPublicId),
    );
}

/** Cards in a workspace relevant to one user: assigned via card_member,
 * or created by them. Powers the /my page — self-host scale, filtered in
 * JS like listCardsDueWithin. */
export async function listMyCards(
  db: Database,
  input: { workspaceId: number; userId: string },
) {
  const [cardRows, listIndex, cardMemberRows, memberRows] = await Promise.all([
    db.findMany("cards") as Promise<CardRow[]>,
    listBoardIndex(db),
    db.findMany("cardMembers") as Promise<CardMemberRow[]>,
    db.findMany("workspaceMembers", { includeDeleted: true }) as Promise<
      WorkspaceMemberRow[]
    >,
  ]);
  const memberMap = new Map(memberRows.map((m) => [m.id, m]));
  const membersByCard = new Map<number, WorkspaceMemberRow[]>();
  for (const cm of cardMemberRows) {
    const member = memberMap.get(cm.memberId);
    if (!member) continue;
    const bucket = membersByCard.get(cm.cardId);
    if (bucket) bucket.push(member);
    else membersByCard.set(cm.cardId, [member]);
  }
  return cardRows
    .map((c) => ({ card: c, list: listIndex.get(c.listId) }))
    .filter(
      (
        x,
      ): x is { card: CardRow; list: ListRow & { board: BoardRow } } =>
        !!x.list &&
        x.list.board.workspaceId === input.workspaceId &&
        !x.list.board.deletedAt &&
        !x.list.deletedAt,
    )
    .map(({ card: c, list }) => ({
      publicId: c.publicId,
      title: c.title,
      dueDate: c.dueDate,
      createdAt: c.createdAt,
      createdByMe: c.createdBy === input.userId,
      assignedToMe: (membersByCard.get(c.id) ?? []).some(
        (m) => m.userId === input.userId,
      ),
      listName: list.name,
      boardPublicId: list.board.publicId,
      boardName: list.board.name,
    }))
    .filter((c) => c.createdByMe || c.assignedToMe);
}

/** Recent agent-authored activity on cards a user created (notification
 * feed source — no new tables). */
export async function listAgentActivityForUser(
  db: Database,
  input: { workspaceId: number; userId: string; limit?: number },
) {
  const [activityRows, cardRows, listIndex, agentMap] = await Promise.all([
    db.findMany("activities", {
      where: { type: "card.comment.created" },
      orderBy: { field: "createdAt", dir: "desc" },
      limit: 200,
    }) as Promise<ActivityRow[]>,
    db.findMany("cards", { includeDeleted: true }) as Promise<CardRow[]>,
    listBoardIndex(db),
    agentsById(db),
  ]);
  const cardMap = new Map(cardRows.map((c) => [c.id, c]));
  return activityRows
    .map((a) => {
      const card = cardMap.get(a.cardId);
      const list = card ? listIndex.get(card.listId) : undefined;
      if (!card || !list) return undefined;
      const agent =
        a.agentIdentityId != null
          ? (agentMap.get(a.agentIdentityId) ?? null)
          : null;
      return { ...a, agent, card: { ...card, list } };
    })
    .filter((a): a is NonNullable<typeof a> => a !== undefined)
    .filter(
      (a) =>
        a.agentIdentityId !== null &&
        a.card.createdBy === input.userId &&
        !a.card.deletedAt &&
        a.card.list.board.workspaceId === input.workspaceId,
    )
    .slice(0, input.limit ?? 20)
    .map((a) => ({
      at: a.createdAt,
      agentName: a.agent?.displayName ?? "Agent",
      agentAvatar: a.agent?.avatar ?? "🤖",
      cardPublicId: a.card.publicId,
      cardTitle: a.card.title,
      boardPublicId: a.card.list.board.publicId,
    }));
}

export async function listCardsByList(db: Database, listId: number) {
  return (await db.findMany("cards", {
    where: { listId },
    orderBy: { field: "index" },
  })) as CardRow[];
}

export { lists };

/* ── trash / restore ───────────────────────────────────────────── */

/** Soft-deleted cards in a workspace (list/board names attached),
 * newest first (30-day display window). */
export async function listDeletedCards(
  db: Database,
  workspaceId: number,
  sinceDays = 30,
) {
  const cutoff = new Date(Date.now() - sinceDays * 86_400_000);
  const cardRows = (await db.findMany("cards", {
    onlyDeleted: true,
    orderBy: { field: "deletedAt", dir: "desc" },
    limit: 300,
  })) as CardRow[];
  const listIndex = await listBoardIndex(db);
  return cardRows
    .map((c) => ({
      ...c,
      list: listIndex.get(c.listId) as ListRow & { board: BoardRow },
    }))
    .filter(
      (c) =>
        c.list &&
        c.list.board.workspaceId === workspaceId &&
        c.deletedAt &&
        c.deletedAt >= cutoff,
    )
    .slice(0, 100);
}

/** Deleted-inclusive getter for the trash restore path. */
export async function getCardAnyByPublicId(db: Database, publicId: string) {
  const card = (await db.findFirst("cards", {
    where: { publicId },
    includeDeleted: true,
  })) as CardRow | undefined;
  if (!card) return undefined;
  const list = await getListWithBoard(db, card.listId);
  return { ...card, list };
}

/** Restore a card; restores its list and board too when they are deleted
 * (a card inside a deleted column would otherwise stay invisible). */
export async function restoreCard(db: Database, cardId: number) {
  const card = (await db.findFirst("cards", {
    where: { id: cardId },
    includeDeleted: true,
  })) as CardRow | undefined;
  if (!card) return;
  const list = await getListWithBoard(db, card.listId);
  if (list.board.deletedAt) {
    await db.update("boards", list.boardId, { deletedAt: null });
  }
  if (list.deletedAt) {
    await db.update("lists", card.listId, { deletedAt: null });
  }
  await db.update("cards", cardId, { deletedAt: null });
}
