import { z } from "zod";

import { boardRepo } from "@kr8kan/db";

import { assertPermission, notFound } from "../permissions";
import { createTRPCRouter, protectedProcedure } from "../trpc";

export const labelRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ boardPublicId: z.string().length(12) }))
    .query(async ({ ctx, input }) => {
      const board = await boardRepo.getBoardByPublicId(
        ctx.db,
        input.boardPublicId,
      );
      if (!board) notFound("board");
      await assertPermission(ctx.db, ctx.user.id, board.workspaceId, "board:view");
      return boardRepo.listLabelsByBoard(ctx.db, board.id);
    }),

  create: protectedProcedure
    .input(
      z.object({
        boardPublicId: z.string().length(12),
        name: z.string().min(1).max(80),
        colourCode: z.string().min(1).max(24),
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
        "label:manage",
      );
      return boardRepo.createLabel(ctx.db, {
        boardId: board.id,
        name: input.name,
        colourCode: input.colourCode,
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        labelPublicId: z.string().length(12),
        name: z.string().min(1).max(80).optional(),
        colourCode: z.string().min(1).max(24).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const label = await boardRepo.getLabelByPublicId(
        ctx.db,
        input.labelPublicId,
      );
      if (!label) notFound("label");
      await assertPermission(
        ctx.db,
        ctx.user.id,
        label.board.workspaceId,
        "label:manage",
      );
      return boardRepo.updateLabel(ctx.db, label.id, {
        name: input.name,
        colourCode: input.colourCode,
      });
    }),

  delete: protectedProcedure
    .input(z.object({ labelPublicId: z.string().length(12) }))
    .mutation(async ({ ctx, input }) => {
      const label = await boardRepo.getLabelByPublicId(
        ctx.db,
        input.labelPublicId,
      );
      if (!label) notFound("label");
      await assertPermission(
        ctx.db,
        ctx.user.id,
        label.board.workspaceId,
        "label:manage",
      );
      await boardRepo.softDeleteLabel(ctx.db, label.id);
      return { success: true };
    }),
});
