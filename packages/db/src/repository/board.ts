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

/** Small parallel batch runner — chunk of ~8 concurrent requests, order
 * preserved. Used throughout this file for per-parent fan-out instead
 * of whole-table reads. */
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

export async function listBoardsByWorkspace(db: Database, workspaceId: number) {
  const rows = (await db.findMany("boards", {
    where: { workspaceId },
    orderBy: { field: "createdAt" },
  })) as BoardRow[];
  // Boards page is hot; ≤25 boards in a workspace does per-board scoped
  // fetches in parallel, above that a single whole-table read (still
  // narrowed to this workspace's boards below) beats rows.length requests.
  let allLists: ListRow[];
  if (rows.length <= 25) {
    allLists = (
      await batched(
        rows,
        (board) =>
          db.findMany("lists", { where: { boardId: board.id } }) as Promise<
            ListRow[]
          >,
      )
    ).flat();
  } else {
    allLists = (await db.findMany("lists")) as ListRow[];
  }
  const listIds = new Set(allLists.map((l) => l.id));
  let allCards: CardRow[];
  if (listIds.size <= 25) {
    allCards = (
      await batched(
        [...listIds],
        (listId) =>
          db.findMany("cards", { where: { listId } }) as Promise<CardRow[]>,
      )
    ).flat();
  } else {
    allCards = ((await db.findMany("cards")) as CardRow[]).filter((c) =>
      listIds.has(c.listId),
    );
  }
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

  // labels: board-scoped fetch (equality FK filter, cheap) feeds the
  // cardLabel join. board.labels excludes deleted; labelById is built
  // from the non-deleted set only — a card chip pointing at a deleted
  // label should not ghost, not silently render the deleted label.
  const allLabels = (await db.findMany("labels", {
    where: { boardId: board.id },
    includeDeleted: true,
  })) as LabelRow[];
  const boardLabels = allLabels.filter((l) => !l.deletedAt);
  const labelById = new Map(boardLabels.map((l) => [l.id, l]));

  const boardLists = (await db.findMany("lists", {
    where: { boardId: board.id },
    orderBy: { field: "index" },
  })) as ListRow[];
  const listIds = [...new Set(boardLists.map((l) => l.id))];

  // Cards per-list, in parallel (a board's list count is small — never
  // an instance-wide read).
  const boardCards = (
    await batched(
      listIds,
      (listId) =>
        db.findMany("cards", {
          where: { listId },
          orderBy: { field: "index" },
        }) as Promise<CardRow[]>,
    )
  ).flat();

  // Join-table projections (cardLabels/cardMembers/comments/checklists):
  // per-card fan-out is fine up to ~50 cards (a few hundred parallel,
  // batched requests); past that a board is large enough that one
  // whole-table read per join table is cheaper than `cardCount` requests
  // each. comments/checklists/checklistItems only ever surface as
  // {id}/{id,completed} projections for badge counts, so soft-deleted
  // checklists/items are excluded here (no includeDeleted) — board badges
  // must agree with the card modal.
  const cardIds = boardCards.map((c) => c.id);
  let allCardLabels: CardLabelRow[];
  let allCardMembers: CardMemberRow[];
  let allComments: CommentRow[];
  let allChecklists: ChecklistRow[];
  let allChecklistItems: ChecklistItemRow[];
  if (cardIds.length > 0 && cardIds.length <= 50) {
    const [cardLabelsPerCard, cardMembersPerCard, commentsPerCard, checklistsPerCard] =
      await Promise.all([
        batched(
          cardIds,
          (cardId) =>
            db.findMany("cardLabels", { where: { cardId } }) as Promise<
              CardLabelRow[]
            >,
        ),
        batched(
          cardIds,
          (cardId) =>
            db.findMany("cardMembers", { where: { cardId } }) as Promise<
              CardMemberRow[]
            >,
        ),
        batched(
          cardIds,
          (cardId) =>
            db.findMany("comments", { where: { cardId } }) as Promise<
              CommentRow[]
            >,
        ),
        batched(
          cardIds,
          (cardId) =>
            db.findMany("checklists", { where: { cardId } }) as Promise<
              ChecklistRow[]
            >,
        ),
      ]);
    allCardLabels = cardLabelsPerCard.flat();
    allCardMembers = cardMembersPerCard.flat();
    allComments = commentsPerCard.flat();
    allChecklists = checklistsPerCard.flat();
    const checklistIds = allChecklists.map((c) => c.id);
    allChecklistItems = (
      await batched(
        checklistIds,
        (checklistId) =>
          db.findMany("checklistItems", {
            where: { checklistId },
          }) as Promise<ChecklistItemRow[]>,
      )
    ).flat();
  } else {
    // Board has 0 or >50 cards: per-card fan-out would be `cardCount`
    // separate requests per join table — a whole-table read is cheaper.
    [allCardLabels, allCardMembers, allComments, allChecklists] = await Promise.all([
      db.findMany("cardLabels") as Promise<CardLabelRow[]>,
      db.findMany("cardMembers") as Promise<CardMemberRow[]>,
      db.findMany("comments") as Promise<CommentRow[]>,
      db.findMany("checklists") as Promise<ChecklistRow[]>,
    ]);
    allChecklistItems = (await db.findMany("checklistItems")) as ChecklistItemRow[];
  }

  // workspaceMembers: equality-filtered by workspaceId (cheap) instead of
  // an instance-wide read. users: only the ids referenced by that roster.
  const allMembers = (await db.findMany("workspaceMembers", {
    where: { workspaceId: board.workspaceId },
    includeDeleted: true,
  })) as MemberRow[];
  const memberById = new Map(allMembers.map((m) => [m.id, m]));
  const userIds = [...new Set(allMembers.map((m) => m.userId))];
  const userRows = await batched(
    userIds,
    (id) => db.findFirst("user", { where: { id } }) as Promise<UserRow | undefined>,
  );
  const userById = new Map<string, UserRow>();
  userRows.forEach((u, i) => {
    if (u) userById.set(userIds[i]!, u);
  });

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
  // Scope to the workspace BEFORE truncating: boards (equality where) →
  // lists per board, instead of a global deleted-lists page filtered
  // after the fact. `onlyDeleted` needs client-side filtering per-board
  // (includeDeleted:true + deletedAt !== null) since the server filter
  // is equality-only.
  const boardRows = (await db.findMany("boards", {
    where: { workspaceId },
    includeDeleted: true,
  })) as BoardRow[];
  const boardById = new Map(boardRows.map((b) => [b.id, b]));
  let deletedLists: ListRow[];
  if (boardRows.length <= 25) {
    const perBoard = await batched(
      boardRows,
      (board) =>
        db.findMany("lists", {
          where: { boardId: board.id },
          includeDeleted: true,
        }) as Promise<ListRow[]>,
    );
    deletedLists = perBoard.flat().filter((l) => l.deletedAt !== null);
  } else {
    // Many boards in this workspace: a single deleted-lists page (still
    // then filtered down to this workspace's boards) beats
    // boardRows.length separate per-board requests.
    deletedLists = (
      (await db.findMany("lists", {
        onlyDeleted: true,
        limit: 200,
      })) as ListRow[]
    ).filter((l) => boardById.has(l.boardId));
  }
  return deletedLists
    .map((l) => ({ ...l, board: boardById.get(l.boardId) as BoardRow }))
    .filter((l) => l.board && l.deletedAt && l.deletedAt >= cutoff)
    .sort((a, b) => (b.deletedAt as Date).getTime() - (a.deletedAt as Date).getTime())
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
