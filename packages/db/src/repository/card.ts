import { and, asc, desc, eq, isNull } from "drizzle-orm";

import { computeMove, generateUID } from "@kr8kan/shared";

import type { Database } from "../client";
import {
  activities,
  cardLabels,
  cardMembers,
  cards,
  checklistItems,
  checklists,
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
        with: { author: true },
      },
      activities: {
        orderBy: desc(activities.createdAt),
        with: { user: true },
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
  input: { cardId: number; comment: string; userId: string },
) {
  const [created] = await db
    .insert(comments)
    .values({
      publicId: generateUID(),
      cardId: input.cardId,
      comment: input.comment,
      createdBy: input.userId,
    })
    .returning();
  await recordActivity(db, {
    cardId: input.cardId,
    type: "card.comment.created",
    userId: input.userId,
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

/* ── activity ──────────────────────────────────────────────────── */

export async function recordActivity(
  db: Database,
  input: {
    cardId: number;
    type: string;
    userId: string;
    metadata?: Record<string, unknown>;
  },
) {
  await db.insert(activities).values({
    publicId: generateUID(),
    cardId: input.cardId,
    type: input.type,
    createdBy: input.userId,
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

export async function listCardsByList(db: Database, listId: number) {
  return db.query.cards.findMany({
    where: and(eq(cards.listId, listId), isNull(cards.deletedAt)),
    orderBy: asc(cards.index),
  });
}

export { lists };
