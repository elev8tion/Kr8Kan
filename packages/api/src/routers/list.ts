import { z } from "zod";

import { boardRepo } from "@kr8kan/db";

import { assertPermission, notFound } from "../permissions";
import { createTRPCRouter, protectedProcedure } from "../trpc";

export const listRouter = createTRPCRouter({
  create: protectedProcedure
    .input(
      z.object({
        boardPublicId: z.string().length(12),
        name: z.string().min(1).max(160),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const board = await boardRepo.getBoardByPublicId(
        ctx.db,
        input.boardPublicId,
      );
      if (!board) notFound("board");
      await assertPermission(
        ctx.db,
        ctx.user.id,
        board.workspaceId,
        "list:create",
      );
      return boardRepo.createList(ctx.db, {
        boardId: board.id,
        name: input.name,
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        listPublicId: z.string().length(12),
        name: z.string().min(1).max(160),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const list = await boardRepo.getListByPublicId(ctx.db, input.listPublicId);
      if (!list) notFound("list");
      await assertPermission(
        ctx.db,
        ctx.user.id,
        list.board.workspaceId,
        "list:edit",
      );
      return boardRepo.updateList(ctx.db, list.id, { name: input.name });
    }),

  reorder: protectedProcedure
    .input(
      z.object({
        listPublicId: z.string().length(12),
        toIndex: z.number().int().min(0).max(1000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const list = await boardRepo.getListByPublicId(ctx.db, input.listPublicId);
      if (!list) notFound("list");
      await assertPermission(
        ctx.db,
        ctx.user.id,
        list.board.workspaceId,
        "list:edit",
      );
      await boardRepo.reorderList(ctx.db, list.id, input.toIndex);
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ listPublicId: z.string().length(12) }))
    .mutation(async ({ ctx, input }) => {
      const list = await boardRepo.getListByPublicId(ctx.db, input.listPublicId);
      if (!list) notFound("list");
      await assertPermission(
        ctx.db,
        ctx.user.id,
        list.board.workspaceId,
        "list:delete",
      );
      await boardRepo.softDeleteList(ctx.db, list.id);
      return { success: true };
    }),
});
