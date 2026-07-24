import { and, asc, desc, eq, gt, isNotNull, isNull, lte } from "drizzle-orm";

import { computeMove, generateUID } from "@kr8kan/shared";

import type { Database } from "../client";
import {
  activities,
  attachments,
  boards,
  cardLabels,
  cardMembers,
  cards,
  checklistItems,
  checklists,
  commentReactions,
  comments,
  lists,
} from "../schema";

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
    const siblings = await tx.query.cards.findMany({
      where: and(eq(cards.listId, input.listId), isNull(cards.deletedAt)),
      columns: { id: true },
    });
    const [card] = await tx
      .insert(cards)
      .values({
        publicId: generateUID(),
        listId: input.listId,
        title: input.title,
        description: input.description,
        index: siblings.length,
        createdBy: input.userId,
      })
      .returning();
    if (!card) throw new Error("failed to create card");
    await tx.insert(activities).values({
      publicId: generateUID(),
      cardId: card.id,
      type: "card.created",
      createdBy: input.userId,
    });
    return card;
  });
}

export async function getCardByPublicId(db: Database, publicId: string) {
  return db.query.cards.findFirst({
    where: and(eq(cards.publicId, publicId), isNull(cards.deletedAt)),
    with: {
      list: { with: { board: { with: { workspace: true } } } },
      labels: { with: { label: true } },
      members: { with: { member: { with: { user: true } } } },
      checklists: {
        where: isNull(checklists.deletedAt),
        orderBy: asc(checklists.index),
        with: {
          items: {
            where: isNull(checklistItems.deletedAt),
            orderBy: asc(checklistItems.index),
          },
        },
      },
      comments: {
        where: isNull(comments.deletedAt),
        orderBy: asc(comments.createdAt),
        with: {
          author: true,
          agent: true,
          reactions: { with: { user: true } },
        },
      },
      activities: {
        orderBy: desc(activities.createdAt),
        with: { user: true, agent: true },
      },
      attachments: true,
    },
  });
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
  const [updated] = await db
    .update(cards)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(cards.id, cardId))
    .returning();
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
 * lists densely inside one transaction (see @kr8kan/shared computeMove).
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
    const card = await tx.query.cards.findFirst({
      where: eq(cards.id, input.cardId),
    });
    if (!card) throw new Error("card not found");

    const sourceCards = await tx.query.cards.findMany({
      where: and(eq(cards.listId, card.listId), isNull(cards.deletedAt)),
      orderBy: asc(cards.index),
      columns: { id: true, index: true },
    });

    const sameList = card.listId === input.toListId;
    const targetCards = sameList
      ? undefined
      : await tx.query.cards.findMany({
          where: and(eq(cards.listId, input.toListId), isNull(cards.deletedAt)),
          orderBy: asc(cards.index),
          columns: { id: true, index: true },
        });

    const { source, target } = computeMove({
      source: sourceCards,
      target: targetCards,
      id: card.id,
      position: input.position,
    });

    for (const row of source) {
      await tx
        .update(cards)
        .set({ index: row.index })
        .where(eq(cards.id, row.id));
    }
    for (const row of target) {
      await tx
        .update(cards)
        .set({ index: row.index, listId: input.toListId })
        .where(eq(cards.id, row.id));
    }
    if (!sameList) {
      await tx
        .update(cards)
        .set({ listId: input.toListId })
        .where(eq(cards.id, card.id));
      await tx.insert(activities).values({
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
  await db
    .update(cards)
    .set({ deletedAt: new Date() })
    .where(eq(cards.id, cardId));
}

/* ── labels / members ──────────────────────────────────────────── */

export async function addLabelToCard(
  db: Database,
  cardId: number,
  labelId: number,
  userId: string,
) {
  await db
    .insert(cardLabels)
    .values({ cardId, labelId })
    .onConflictDoNothing();
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
  await db
    .delete(cardLabels)
    .where(and(eq(cardLabels.cardId, cardId), eq(cardLabels.labelId, labelId)));
}

export async function addMemberToCard(
  db: Database,
  cardId: number,
  memberId: number,
  userId: string,
) {
  await db
    .insert(cardMembers)
    .values({ cardId, memberId })
    .onConflictDoNothing();
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
  await db
    .delete(cardMembers)
    .where(
      and(eq(cardMembers.cardId, cardId), eq(cardMembers.memberId, memberId)),
    );
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
  const [created] = await db
    .insert(comments)
    .values({
      publicId: generateUID(),
      cardId: input.cardId,
      comment: input.comment,
      createdBy: input.userId,
      agentIdentityId: input.agentIdentityId,
    })
    .returning();
  await recordActivity(db, {
    cardId: input.cardId,
    type: "card.comment.created",
    userId: input.userId,
    agentIdentityId: input.agentIdentityId,
  });
  return created;
}

export async function getCommentByPublicId(db: Database, publicId: string) {
  return db.query.comments.findFirst({
    where: and(eq(comments.publicId, publicId), isNull(comments.deletedAt)),
    with: { card: { with: { list: { with: { board: true } } } } },
  });
}

export async function updateComment(
  db: Database,
  commentId: number,
  text: string,
) {
  const [updated] = await db
    .update(comments)
    .set({ comment: text, updatedAt: new Date() })
    .where(eq(comments.id, commentId))
    .returning();
  return updated;
}

export async function softDeleteComment(db: Database, commentId: number) {
  await db
    .update(comments)
    .set({ deletedAt: new Date() })
    .where(eq(comments.id, commentId));
}

/* ── checklists ────────────────────────────────────────────────── */

export async function createChecklist(
  db: Database,
  input: { cardId: number; name: string },
) {
  const existing = await db.query.checklists.findMany({
    where: and(eq(checklists.cardId, input.cardId), isNull(checklists.deletedAt)),
    columns: { id: true },
  });
  const [checklist] = await db
    .insert(checklists)
    .values({
      publicId: generateUID(),
      cardId: input.cardId,
      name: input.name,
      index: existing.length,
    })
    .returning();
  return checklist;
}

export async function getChecklistByPublicId(db: Database, publicId: string) {
  return db.query.checklists.findFirst({
    where: and(eq(checklists.publicId, publicId), isNull(checklists.deletedAt)),
    with: { card: true },
  });
}

export async function softDeleteChecklist(db: Database, checklistId: number) {
  await db
    .update(checklists)
    .set({ deletedAt: new Date() })
    .where(eq(checklists.id, checklistId));
}

export async function addChecklistItem(
  db: Database,
  input: { checklistId: number; title: string },
) {
  const existing = await db.query.checklistItems.findMany({
    where: and(
      eq(checklistItems.checklistId, input.checklistId),
      isNull(checklistItems.deletedAt),
    ),
    columns: { id: true },
  });
  const [item] = await db
    .insert(checklistItems)
    .values({
      publicId: generateUID(),
      checklistId: input.checklistId,
      title: input.title,
      index: existing.length,
    })
    .returning();
  return item;
}

export async function getChecklistItemByPublicId(
  db: Database,
  publicId: string,
) {
  return db.query.checklistItems.findFirst({
    where: and(
      eq(checklistItems.publicId, publicId),
      isNull(checklistItems.deletedAt),
    ),
    with: { checklist: { with: { card: true } } },
  });
}

export async function updateChecklistItem(
  db: Database,
  itemId: number,
  input: { title?: string; completed?: boolean },
) {
  const [updated] = await db
    .update(checklistItems)
    .set(input)
    .where(eq(checklistItems.id, itemId))
    .returning();
  return updated;
}

export async function softDeleteChecklistItem(db: Database, itemId: number) {
  await db
    .update(checklistItems)
    .set({ deletedAt: new Date() })
    .where(eq(checklistItems.id, itemId));
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
  const [row] = await db
    .insert(attachments)
    .values({
      publicId: generateUID(),
      cardId: input.cardId,
      filename: input.filename,
      key: input.key,
      contentType: input.contentType,
      size: input.size,
      createdBy: input.userId,
    })
    .returning();
  return row;
}

export async function getAttachmentByPublicId(db: Database, publicId: string) {
  return db.query.attachments.findFirst({
    where: and(eq(attachments.publicId, publicId), isNull(attachments.deletedAt)),
    with: { card: { with: { list: { with: { board: true } } } } },
  });
}

export async function softDeleteAttachment(db: Database, attachmentId: number) {
  await db
    .update(attachments)
    .set({ deletedAt: new Date() })
    .where(eq(attachments.id, attachmentId));
}

/* ── reactions ─────────────────────────────────────────────────── */

export async function addReaction(
  db: Database,
  input: { commentId: number; emoji: string; userId: string },
) {
  const [row] = await db
    .insert(commentReactions)
    .values(input)
    .onConflictDoNothing()
    .returning();
  return row ?? null;
}

export async function removeReaction(
  db: Database,
  input: { commentId: number; emoji: string; userId: string },
) {
  await db
    .delete(commentReactions)
    .where(
      and(
        eq(commentReactions.commentId, input.commentId),
        eq(commentReactions.emoji, input.emoji),
        eq(commentReactions.userId, input.userId),
      ),
    );
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
  await db.insert(activities).values({
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
  return db.query.cards.findFirst({
    where: and(eq(cards.publicId, cardPublicId), isNull(cards.deletedAt)),
    with: {
      list: { with: { board: { with: { workspace: true } } } },
    },
  });
}

/** Cards in a workspace (optionally one board) due within `hours` from
 * now — the card.due trigger's scan set. */
export async function listCardsDueWithin(
  db: Database,
  input: { workspaceId: number; boardPublicId?: string; hours: number },
) {
  const now = new Date();
  const until = new Date(now.getTime() + input.hours * 3600_000);
  const rows = await db.query.cards.findMany({
    where: and(
      isNull(cards.deletedAt),
      gt(cards.dueDate, now),
      lte(cards.dueDate, until),
    ),
    with: { list: { with: { board: true } } },
    columns: { publicId: true, title: true, dueDate: true },
  });
  return rows.filter(
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
  const rows = await db.query.cards.findMany({
    where: isNull(cards.deletedAt),
    with: {
      list: { with: { board: true } },
      members: { with: { member: true } },
    },
  });
  return rows
    .filter(
      (c) =>
        c.list.board.workspaceId === input.workspaceId &&
        !c.list.board.deletedAt &&
        !c.list.deletedAt,
    )
    .map((c) => ({
      publicId: c.publicId,
      title: c.title,
      dueDate: c.dueDate,
      createdAt: c.createdAt,
      createdByMe: c.createdBy === input.userId,
      assignedToMe: c.members.some((m) => m.member.userId === input.userId),
      listName: c.list.name,
      boardPublicId: c.list.board.publicId,
      boardName: c.list.board.name,
    }))
    .filter((c) => c.createdByMe || c.assignedToMe);
}

/** Recent agent-authored activity on cards a user created (notification
 * feed source — no new tables). */
export async function listAgentActivityForUser(
  db: Database,
  input: { workspaceId: number; userId: string; limit?: number },
) {
  const rows = await db.query.activities.findMany({
    where: eq(activities.type, "card.comment.created"),
    orderBy: desc(activities.createdAt),
    limit: 200,
    with: {
      agent: true,
      card: { with: { list: { with: { board: true } } } },
    },
  });
  return rows
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
  return db.query.cards.findMany({
    where: and(eq(cards.listId, listId), isNull(cards.deletedAt)),
    orderBy: asc(cards.index),
  });
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
  const rows = await db.query.cards.findMany({
    where: isNotNull(cards.deletedAt),
    with: { list: { with: { board: true } } },
    orderBy: desc(cards.deletedAt),
    limit: 300,
  });
  return rows
    .filter(
      (c) =>
        c.list.board.workspaceId === workspaceId &&
        c.deletedAt &&
        c.deletedAt >= cutoff,
    )
    .slice(0, 100);
}

/** Deleted-inclusive getter for the trash restore path. */
export async function getCardAnyByPublicId(db: Database, publicId: string) {
  return db.query.cards.findFirst({
    where: eq(cards.publicId, publicId),
    with: { list: { with: { board: true } } },
  });
}

/** Restore a card; restores its list and board too when they are deleted
 * (a card inside a deleted column would otherwise stay invisible). */
export async function restoreCard(db: Database, cardId: number) {
  const card = await db.query.cards.findFirst({
    where: eq(cards.id, cardId),
    with: { list: { with: { board: true } } },
  });
  if (!card) return;
  if (card.list.board.deletedAt) {
    await db
      .update(boards)
      .set({ deletedAt: null })
      .where(eq(boards.id, card.list.boardId));
  }
  if (card.list.deletedAt) {
    await db
      .update(lists)
      .set({ deletedAt: null })
      .where(eq(lists.id, card.listId));
  }
  await db.update(cards).set({ deletedAt: null }).where(eq(cards.id, cardId));
}
