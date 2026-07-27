import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";

import { generateUID, uniqueSlug } from "@kr8kan/shared";

import type { Database } from "../client";
import { boards, cards, comments, labels, lists } from "../schema";

export async function listBoardsByWorkspace(db: Database, workspaceId: number) {
  const rows = await db.query.boards.findMany({
    where: and(eq(boards.workspaceId, workspaceId), isNull(boards.deletedAt)),
    orderBy: asc(boards.createdAt),
    with: {
      lists: {
        where: isNull(lists.deletedAt),
        columns: { id: true },
        with: {
          cards: { where: isNull(cards.deletedAt), columns: { id: true } },
        },
      },
    },
  });
  return rows.map(({ lists: boardLists, ...board }) => ({
    ...board,
    listCount: boardLists.length,
    cardCount: boardLists.reduce((sum, l) => sum + l.cards.length, 0),
  }));
}

export async function createBoard(
  db: Database,
  input: {
    workspaceId: number;
    name: string;
    userId: string;
    defaultLists?: string[];
  },
) {
  return db.transaction(async (tx) => {
    const [board] = await tx
      .insert(boards)
      .values({
        publicId: generateUID(),
        workspaceId: input.workspaceId,
        name: input.name,
        slug: uniqueSlug(input.name),
        createdBy: input.userId,
      })
      .returning();
    if (!board) throw new Error("failed to create board");
    const names = input.defaultLists ?? [];
    for (let i = 0; i < names.length; i++) {
      await tx.insert(lists).values({
        publicId: generateUID(),
        boardId: board.id,
        name: names[i]!,
        index: i,
      });
    }
    return board;
  });
}

export async function getBoardByPublicId(db: Database, publicId: string) {
  return db.query.boards.findFirst({
    where: and(eq(boards.publicId, publicId), isNull(boards.deletedAt)),
    with: { workspace: true },
  });
}

/** Full board payload for the kanban view. */
export async function getBoardWithContents(db: Database, publicId: string) {
  return db.query.boards.findFirst({
    where: and(eq(boards.publicId, publicId), isNull(boards.deletedAt)),
    with: {
      workspace: true,
      labels: { where: isNull(labels.deletedAt) },
      lists: {
        where: isNull(lists.deletedAt),
        orderBy: asc(lists.index),
        with: {
          cards: {
            where: isNull(cards.deletedAt),
            orderBy: asc(cards.index),
            with: {
              labels: { with: { label: true } },
              members: { with: { member: { with: { user: true } } } },
              comments: {
                where: isNull(comments.deletedAt),
                columns: { id: true },
              },
              checklists: {
                columns: { id: true },
                with: { items: { columns: { id: true, completed: true } } },
              },
            },
          },
        },
      },
    },
  });
}

export async function updateBoard(
  db: Database,
  boardId: number,
  input: {
    name?: string;
    visibility?: "private" | "public";
    agentPath?: string | null;
    agentVerifyCommand?: string | null;
    agentBrowserUrl?: string | null;
  },
) {
  const [updated] = await db
    .update(boards)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(boards.id, boardId))
    .returning();
  return updated;
}

export async function softDeleteBoard(db: Database, boardId: number) {
  await db
    .update(boards)
    .set({ deletedAt: new Date() })
    .where(eq(boards.id, boardId));
}

/* ── lists ─────────────────────────────────────────────────────── */

export async function getListByPublicId(db: Database, publicId: string) {
  return db.query.lists.findFirst({
    where: and(eq(lists.publicId, publicId), isNull(lists.deletedAt)),
    with: { board: { with: { workspace: true } } },
  });
}

export async function createList(
  db: Database,
  input: { boardId: number; name: string },
) {
  const existing = await db.query.lists.findMany({
    where: and(eq(lists.boardId, input.boardId), isNull(lists.deletedAt)),
  });
  const [list] = await db
    .insert(lists)
    .values({
      publicId: generateUID(),
      boardId: input.boardId,
      name: input.name,
      index: existing.length,
    })
    .returning();
  return list;
}

export async function updateList(
  db: Database,
  listId: number,
  input: { name?: string },
) {
  const [updated] = await db
    .update(lists)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(lists.id, listId))
    .returning();
  return updated;
}

export async function reorderList(
  db: Database,
  listId: number,
  toIndex: number,
) {
  await db.transaction(async (tx) => {
    const list = await tx.query.lists.findFirst({
      where: eq(lists.id, listId),
    });
    if (!list) throw new Error("list not found");
    const siblings = await tx.query.lists.findMany({
      where: and(eq(lists.boardId, list.boardId), isNull(lists.deletedAt)),
      orderBy: asc(lists.index),
    });
    const others = siblings.filter((l) => l.id !== listId);
    const clamped = Math.max(0, Math.min(toIndex, others.length));
    others.splice(clamped, 0, list);
    for (let i = 0; i < others.length; i++) {
      if (others[i]!.index !== i) {
        await tx.update(lists).set({ index: i }).where(eq(lists.id, others[i]!.id));
      }
    }
  });
}

export async function softDeleteList(db: Database, listId: number) {
  await db
    .update(lists)
    .set({ deletedAt: new Date() })
    .where(eq(lists.id, listId));
}

/* ── labels ────────────────────────────────────────────────────── */

export async function listLabelsByBoard(db: Database, boardId: number) {
  return db.query.labels.findMany({
    where: and(eq(labels.boardId, boardId), isNull(labels.deletedAt)),
    orderBy: asc(labels.createdAt),
  });
}

export async function getLabelByPublicId(db: Database, publicId: string) {
  return db.query.labels.findFirst({
    where: and(eq(labels.publicId, publicId), isNull(labels.deletedAt)),
    with: { board: { with: { workspace: true } } },
  });
}

export async function createLabel(
  db: Database,
  input: { boardId: number; name: string; colourCode: string },
) {
  const [label] = await db
    .insert(labels)
    .values({ publicId: generateUID(), ...input })
    .returning();
  return label;
}

export async function updateLabel(
  db: Database,
  labelId: number,
  input: { name?: string; colourCode?: string },
) {
  const [updated] = await db
    .update(labels)
    .set(input)
    .where(eq(labels.id, labelId))
    .returning();
  return updated;
}

export async function softDeleteLabel(db: Database, labelId: number) {
  await db
    .update(labels)
    .set({ deletedAt: new Date() })
    .where(eq(labels.id, labelId));
}

/* ── trash / restore ───────────────────────────────────────────── */

/** Soft-deleted boards in a workspace, newest first (30-day display window). */
export async function listDeletedBoards(
  db: Database,
  workspaceId: number,
  sinceDays = 30,
) {
  const cutoff = new Date(Date.now() - sinceDays * 86_400_000);
  const rows = await db.query.boards.findMany({
    where: and(eq(boards.workspaceId, workspaceId), isNotNull(boards.deletedAt)),
    orderBy: desc(boards.deletedAt),
    limit: 100,
  });
  return rows.filter((b) => b.deletedAt && b.deletedAt >= cutoff);
}

/** Soft-deleted lists in a workspace (board name attached), newest first. */
export async function listDeletedLists(
  db: Database,
  workspaceId: number,
  sinceDays = 30,
) {
  const cutoff = new Date(Date.now() - sinceDays * 86_400_000);
  const rows = await db.query.lists.findMany({
    where: isNotNull(lists.deletedAt),
    with: { board: true },
    orderBy: desc(lists.deletedAt),
    limit: 200,
  });
  return rows
    .filter(
      (l) =>
        l.board.workspaceId === workspaceId &&
        l.deletedAt &&
        l.deletedAt >= cutoff,
    )
    .slice(0, 100);
}

/** Deleted-inclusive getters — the trash restore path needs to resolve
 * entities the normal getters hide. */
export async function getBoardAnyByPublicId(db: Database, publicId: string) {
  return db.query.boards.findFirst({ where: eq(boards.publicId, publicId) });
}

export async function getListAnyByPublicId(db: Database, publicId: string) {
  return db.query.lists.findFirst({
    where: eq(lists.publicId, publicId),
    with: { board: true },
  });
}

export async function restoreBoard(db: Database, boardId: number) {
  await db.update(boards).set({ deletedAt: null }).where(eq(boards.id, boardId));
}

/** Restore a list; restores its board too when the board is deleted. */
export async function restoreList(db: Database, listId: number) {
  const list = await db.query.lists.findFirst({
    where: eq(lists.id, listId),
    with: { board: true },
  });
  if (!list) return;
  if (list.board.deletedAt) await restoreBoard(db, list.boardId);
  await db.update(lists).set({ deletedAt: null }).where(eq(lists.id, listId));
}
