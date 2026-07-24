import { z } from "zod";

import { boardRepo, cardRepo, workspaceRepo } from "@kr8kan/db";

import { audit } from "../audit";
import { assertPermission, notFound } from "../permissions";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * trash.* — soft-deleted boards/lists/cards, restorable. Listing needs
 * workspace:edit; restoring needs the same permission deleting did
 * (card:delete / list:delete / board:delete). Nothing is ever purged
 * here — the 30-day window is display scoping only.
 */

export const trashRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ workspacePublicId: z.string().length(12) }))
    .query(async ({ ctx, input }) => {
      const workspace = await workspaceRepo.getWorkspaceByPublicId(
        ctx.db,
        input.workspacePublicId,
      );
      if (!workspace) notFound("workspace");
      await assertPermission(ctx.db, ctx.user.id, workspace.id, "workspace:edit");
      const [boards, lists, cards] = await Promise.all([
        boardRepo.listDeletedBoards(ctx.db, workspace.id),
        boardRepo.listDeletedLists(ctx.db, workspace.id),
        cardRepo.listDeletedCards(ctx.db, workspace.id),
      ]);
      return {
        boards: boards.map((b) => ({
          publicId: b.publicId,
          name: b.name,
          deletedAt: b.deletedAt,
        })),
        lists: lists.map((l) => ({
          publicId: l.publicId,
          name: l.name,
          boardName: l.board.name,
          deletedAt: l.deletedAt,
        })),
        cards: cards.map((c) => ({
          publicId: c.publicId,
          title: c.title,
          listName: c.list.name,
          boardName: c.list.board.name,
          deletedAt: c.deletedAt,
        })),
      };
    }),

  restore: protectedProcedure
    .input(
      z.object({
        entityType: z.enum(["card", "list", "board"]),
        publicId: z.string().length(12),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      let workspaceId: number;
      switch (input.entityType) {
        case "card": {
          const card = await cardRepo.getCardAnyByPublicId(ctx.db, input.publicId);
          if (!card || !card.deletedAt) notFound("card");
          workspaceId = card.list.board.workspaceId;
          await assertPermission(ctx.db, ctx.user.id, workspaceId, "card:delete");
          await cardRepo.restoreCard(ctx.db, card.id);
          break;
        }
        case "list": {
          const list = await boardRepo.getListAnyByPublicId(ctx.db, input.publicId);
          if (!list || !list.deletedAt) notFound("list");
          workspaceId = list.board.workspaceId;
          await assertPermission(ctx.db, ctx.user.id, workspaceId, "list:delete");
          await boardRepo.restoreList(ctx.db, list.id);
          break;
        }
        case "board": {
          const board = await boardRepo.getBoardAnyByPublicId(ctx.db, input.publicId);
          if (!board || !board.deletedAt) notFound("board");
          workspaceId = board.workspaceId;
          await assertPermission(ctx.db, ctx.user.id, workspaceId, "board:delete");
          await boardRepo.restoreBoard(ctx.db, board.id);
          break;
        }
      }
      audit(ctx.db, {
        workspaceId,
        eventType: "trash.restored",
        entityType: input.entityType,
        entityPublicId: input.publicId,
        actorUserId: ctx.user.id,
      });
      return { success: true };
    }),
});
