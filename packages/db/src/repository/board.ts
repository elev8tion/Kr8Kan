import { generateUID, uniqueSlug } from "@kr8kan/shared";

import type { Database } from "../client";
import type {
  boards,
  cardLabels,
  cardMembers,
  cards,
  checklistItems,
  checklists,
  comments,
  labels,
  lists,
  user,
  workspaceMembers,
  workspaces,
} from "../schema";

type BoardRow = typeof boards.$inferSelect;
type ListRow = typeof lists.$inferSelect;
type CardRow = typeof cards.$inferSelect;
type LabelRow = typeof labels.$inferSelect;
type WorkspaceRow = typeof workspaces.$inferSelect;
type CardLabelRow = typeof cardLabels.$inferSelect;
type CardMemberRow = typeof cardMembers.$inferSelect;
type MemberRow = typeof workspaceMembers.$inferSelect;
type UserRow = typeof user.$inferSelect;
type CommentRow = typeof comments.$inferSelect;
type ChecklistRow = typeof checklists.$inferSelect;
type ChecklistItemRow = typeof checklistItems.$inferSelect;

export async function listBoardsByWorkspace(db: Database, workspaceId: number) {
  const rows = (await db.findMany("boards", {
    where: { workspaceId },
    orderBy: { field: "createdAt" },
  })) as BoardRow[];
  const allLists = (await db.findMany("lists")) as ListRow[];
  const allCards = (await db.findMany("cards")) as CardRow[];
  const cardCountByList = new Map<number, number>();
  for (const c of allCards) {
    cardCountByList.set(c.listId, (cardCountByList.get(c.listId) ?? 0) + 1);
  }
  return rows.map((board) => {
    const boardLists = allLists.filter((l) => l.boardId === board.id);
    return {
      ...board,
      listCount: boardLists.length,
      cardCount: boardLists.reduce(
        (sum, l) => sum + (cardCountByList.get(l.id) ?? 0),
        0,
      ),
    };
  });
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
    const board = (await tx.insert("boards", {
      publicId: generateUID(),
      workspaceId: input.workspaceId,
      name: input.name,
      slug: uniqueSlug(input.name),
      createdBy: input.userId,
    })) as BoardRow;
    if (!board) throw new Error("failed to create board");
    const names = input.defaultLists ?? [];
    for (let i = 0; i < names.length; i++) {
      await tx.insert("lists", {
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
  const board = (await db.findFirst("boards", { where: { publicId } })) as
    | BoardRow
    | undefined;
  if (!board) return undefined;
  const workspace = (await db.findFirst("workspaces", {
    where: { id: board.workspaceId },
    includeDeleted: true,
  })) as WorkspaceRow | undefined;
  return { ...board, workspace: (workspace ?? null) as WorkspaceRow };
}

/** Full board payload for the kanban view. */
export async function getBoardWithContents(db: Database, publicId: string) {
  const board = (await db.findFirst("boards", { where: { publicId } })) as
    | BoardRow
    | undefined;
  if (!board) return undefined;

  const workspace = (await db.findFirst("workspaces", {
    where: { id: board.workspaceId },
    includeDeleted: true,
  })) as WorkspaceRow | undefined;

  // labels: deleted-inclusive fetch feeds the cardLabel join (drizzle's
  // `with: { label: true }` did not filter), board.labels excludes deleted
  const allLabels = (await db.findMany("labels", {
    includeDeleted: true,
  })) as LabelRow[];
  const boardLabels = allLabels.filter(
    (l) => l.boardId === board.id && !l.deletedAt,
  );
  const labelById = new Map(allLabels.map((l) => [l.id, l]));

  const boardLists = (await db.findMany("lists", {
    where: { boardId: board.id },
    orderBy: { field: "index" },
  })) as ListRow[];
  const listIds = new Set(boardLists.map((l) => l.id));

  const allCards = (await db.findMany("cards", {
    orderBy: { field: "index" },
  })) as CardRow[];
  const boardCards = allCards.filter((c) => listIds.has(c.listId));
  const cardIds = new Set(boardCards.map((c) => c.id));

  const allCardLabels = (await db.findMany("cardLabels")) as CardLabelRow[];
  const allCardMembers = (await db.findMany("cardMembers")) as CardMemberRow[];
  const allMembers = (await db.findMany("workspaceMembers", {
    includeDeleted: true,
  })) as MemberRow[];
  const memberById = new Map(allMembers.map((m) => [m.id, m]));
  const users = (await db.findMany("user")) as UserRow[];
  const userById = new Map(users.map((u) => [u.id, u]));
  const allComments = (await db.findMany("comments")) as CommentRow[];
  const allChecklists = (await db.findMany("checklists", {
    includeDeleted: true,
  })) as ChecklistRow[];
  const allChecklistItems = (await db.findMany("checklistItems", {
    includeDeleted: true,
  })) as ChecklistItemRow[];

  const cardsWithRelations = boardCards.map((card) => ({
    ...card,
    labels: allCardLabels
      .filter((cl) => cl.cardId === card.id)
      .map((cl) => ({
        ...cl,
        label: (labelById.get(cl.labelId) ?? null) as LabelRow,
      })),
    members: allCardMembers
      .filter((cm) => cm.cardId === card.id)
      .map((cm) => {
        const member = memberById.get(cm.memberId);
        return {
          ...cm,
          member: (member
            ? { ...member, user: (userById.get(member.userId) ?? null) as UserRow }
            : null) as MemberRow & { user: UserRow },
        };
      }),
    comments: allComments
      .filter((c) => c.cardId === card.id)
      .map((c) => ({ id: c.id })),
    checklists: allChecklists
      .filter((ch) => ch.cardId === card.id)
      .map((ch) => ({
        id: ch.id,
        items: allChecklistItems
          .filter((it) => it.checklistId === ch.id)
          .map((it) => ({ id: it.id, completed: it.completed })),
      })),
  }));

  const cardsByList = new Map<number, typeof cardsWithRelations>();
  for (const card of cardsWithRelations) {
    const bucket = cardsByList.get(card.listId);
    if (bucket) bucket.push(card);
    else cardsByList.set(card.listId, [card]);
  }

  return {
    ...board,
    workspace: (workspace ?? null) as WorkspaceRow,
    labels: boardLabels,
    lists: boardLists.map((list) => ({
      ...list,
      cards: cardsByList.get(list.id) ?? [],
    })),
  };
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
  return (await db.update("boards", boardId, {
    ...input,
    updatedAt: new Date(),
  })) as BoardRow | undefined;
}

export async function softDeleteBoard(db: Database, boardId: number) {
  await db.softDelete("boards", boardId);
}

/* ── lists ─────────────────────────────────────────────────────── */

export async function getListByPublicId(db: Database, publicId: string) {
  const list = (await db.findFirst("lists", { where: { publicId } })) as
    | ListRow
    | undefined;
  if (!list) return undefined;
  const board = (await db.findFirst("boards", {
    where: { id: list.boardId },
    includeDeleted: true,
  })) as BoardRow | undefined;
  const workspace = board
    ? ((await db.findFirst("workspaces", {
        where: { id: board.workspaceId },
        includeDeleted: true,
      })) as WorkspaceRow | undefined)
    : undefined;
  return {
    ...list,
    board: (board
      ? { ...board, workspace: (workspace ?? null) as WorkspaceRow }
      : null) as BoardRow & { workspace: WorkspaceRow },
  };
}

export async function createList(
  db: Database,
  input: { boardId: number; name: string },
) {
  const existing = (await db.findMany("lists", {
    where: { boardId: input.boardId },
  })) as ListRow[];
  return (await db.insert("lists", {
    publicId: generateUID(),
    boardId: input.boardId,
    name: input.name,
    index: existing.length,
  })) as ListRow;
}

export async function updateList(
  db: Database,
  listId: number,
  input: { name?: string },
) {
  return (await db.update("lists", listId, {
    ...input,
    updatedAt: new Date(),
  })) as ListRow | undefined;
}

export async function reorderList(
  db: Database,
  listId: number,
  toIndex: number,
) {
  await db.transaction(async (tx) => {
    const list = (await tx.findFirst("lists", {
      where: { id: listId },
      includeDeleted: true,
    })) as ListRow | undefined;
    if (!list) throw new Error("list not found");
    const siblings = (await tx.findMany("lists", {
      where: { boardId: list.boardId },
      orderBy: { field: "index" },
    })) as ListRow[];
    const others = siblings.filter((l) => l.id !== listId);
    const clamped = Math.max(0, Math.min(toIndex, others.length));
    others.splice(clamped, 0, list);
    for (let i = 0; i < others.length; i++) {
      if (others[i]!.index !== i) {
        await tx.update("lists", others[i]!.id, { index: i });
      }
    }
  });
}

export async function softDeleteList(db: Database, listId: number) {
  await db.softDelete("lists", listId);
}

/* ── labels ────────────────────────────────────────────────────── */

export async function listLabelsByBoard(db: Database, boardId: number) {
  return (await db.findMany("labels", {
    where: { boardId },
    orderBy: { field: "createdAt" },
  })) as LabelRow[];
}

export async function getLabelByPublicId(db: Database, publicId: string) {
  const label = (await db.findFirst("labels", { where: { publicId } })) as
    | LabelRow
    | undefined;
  if (!label) return undefined;
  const board = (await db.findFirst("boards", {
    where: { id: label.boardId },
    includeDeleted: true,
  })) as BoardRow | undefined;
  const workspace = board
    ? ((await db.findFirst("workspaces", {
        where: { id: board.workspaceId },
        includeDeleted: true,
      })) as WorkspaceRow | undefined)
    : undefined;
  return {
    ...label,
    board: (board
      ? { ...board, workspace: (workspace ?? null) as WorkspaceRow }
      : null) as BoardRow & { workspace: WorkspaceRow },
  };
}

export async function createLabel(
  db: Database,
  input: { boardId: number; name: string; colourCode: string },
) {
  return (await db.insert("labels", {
    publicId: generateUID(),
    ...input,
  })) as LabelRow;
}

export async function updateLabel(
  db: Database,
  labelId: number,
  input: { name?: string; colourCode?: string },
) {
  return (await db.update("labels", labelId, input)) as LabelRow | undefined;
}

export async function softDeleteLabel(db: Database, labelId: number) {
  await db.softDelete("labels", labelId);
}

/* ── trash / restore ───────────────────────────────────────────── */

/** Soft-deleted boards in a workspace, newest first (30-day display window). */
export async function listDeletedBoards(
  db: Database,
  workspaceId: number,
  sinceDays = 30,
) {
  const cutoff = new Date(Date.now() - sinceDays * 86_400_000);
  const rows = (await db.findMany("boards", {
    where: { workspaceId },
    onlyDeleted: true,
    orderBy: { field: "deletedAt", dir: "desc" },
    limit: 100,
  })) as BoardRow[];
  return rows.filter((b) => b.deletedAt && b.deletedAt >= cutoff);
}

/** Soft-deleted lists in a workspace (board name attached), newest first. */
export async function listDeletedLists(
  db: Database,
  workspaceId: number,
  sinceDays = 30,
) {
  const cutoff = new Date(Date.now() - sinceDays * 86_400_000);
  const rows = (await db.findMany("lists", {
    onlyDeleted: true,
    orderBy: { field: "deletedAt", dir: "desc" },
    limit: 200,
  })) as ListRow[];
  const allBoards = (await db.findMany("boards", {
    includeDeleted: true,
  })) as BoardRow[];
  const boardById = new Map(allBoards.map((b) => [b.id, b]));
  return rows
    .map((l) => ({ ...l, board: boardById.get(l.boardId) as BoardRow }))
    .filter(
      (l) =>
        l.board &&
        l.board.workspaceId === workspaceId &&
        l.deletedAt &&
        l.deletedAt >= cutoff,
    )
    .slice(0, 100);
}

/** Deleted-inclusive getters — the trash restore path needs to resolve
 * entities the normal getters hide. */
export async function getBoardAnyByPublicId(db: Database, publicId: string) {
  return (await db.findFirst("boards", {
    where: { publicId },
    includeDeleted: true,
  })) as BoardRow | undefined;
}

export async function getListAnyByPublicId(db: Database, publicId: string) {
  const list = (await db.findFirst("lists", {
    where: { publicId },
    includeDeleted: true,
  })) as ListRow | undefined;
  if (!list) return undefined;
  const board = (await db.findFirst("boards", {
    where: { id: list.boardId },
    includeDeleted: true,
  })) as BoardRow | undefined;
  return { ...list, board: (board ?? null) as BoardRow };
}

export async function restoreBoard(db: Database, boardId: number) {
  await db.update("boards", boardId, { deletedAt: null });
}

/** Restore a list; restores its board too when the board is deleted. */
export async function restoreList(db: Database, listId: number) {
  const list = (await db.findFirst("lists", {
    where: { id: listId },
    includeDeleted: true,
  })) as ListRow | undefined;
  if (!list) return;
  const board = (await db.findFirst("boards", {
    where: { id: list.boardId },
    includeDeleted: true,
  })) as BoardRow | undefined;
  if (board?.deletedAt) await restoreBoard(db, list.boardId);
  await db.update("lists", listId, { deletedAt: null });
}
