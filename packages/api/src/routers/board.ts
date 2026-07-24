import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { resolveProjectPath } from "@kr8kan/agents";
import { boardRepo } from "@kr8kan/db";

import { assertPermission, notFound } from "../permissions";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { requireWorkspaceByPublicId } from "./workspace";

export const boardRouter = createTRPCRouter({
  list: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/workspaces/{workspacePublicId}/boards",
        tags: ["board"],
      },
    })
    .input(z.object({ workspacePublicId: z.string().length(12) }))
    .output(z.any())
    .query(async ({ ctx, input }) => {
      const workspace = await requireWorkspaceByPublicId(
        ctx.db,
        input.workspacePublicId,
      );
      await assertPermission(ctx.db, ctx.user.id, workspace.id, "board:view");
      return boardRepo.listBoardsByWorkspace(ctx.db, workspace.id);
    }),

  byPublicId: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/boards/{boardPublicId}",
        tags: ["board"],
      },
    })
    .input(z.object({ boardPublicId: z.string().length(12) }))
    .output(z.any())
    .query(async ({ ctx, input }) => {
      const board = await boardRepo.getBoardWithContents(
        ctx.db,
        input.boardPublicId,
      );
      if (!board) notFound("board");
      await assertPermission(
        ctx.db,
        ctx.user.id,
        board.workspaceId,
        "board:view",
      );
      return board;
    }),

  create: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/workspaces/{workspacePublicId}/boards",
        tags: ["board"],
      },
    })
    .input(
      z.object({
        workspacePublicId: z.string().length(12),
        name: z.string().min(1).max(160),
        defaultLists: z.array(z.string().min(1).max(160)).max(10).optional(),
      }),
    )
    .output(z.any())
    .mutation(async ({ ctx, input }) => {
      const workspace = await requireWorkspaceByPublicId(
        ctx.db,
        input.workspacePublicId,
      );
      await assertPermission(ctx.db, ctx.user.id, workspace.id, "board:create");
      return boardRepo.createBoard(ctx.db, {
        workspaceId: workspace.id,
        name: input.name,
        userId: ctx.user.id,
        defaultLists: input.defaultLists ?? ["To do", "Doing", "Done"],
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        boardPublicId: z.string().length(12),
        name: z.string().min(1).max(160).optional(),
        visibility: z.enum(["private", "public"]).optional(),
        agentPath: z.string().max(500).nullish(),
        agentVerifyCommand: z.string().max(500).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const board = await boardRepo.getBoardByPublicId(
        ctx.db,
        input.boardPublicId,
      );
      if (!board) notFound("board");
      await assertPermission(ctx.db, ctx.user.id, board.workspaceId, "board:edit");
      let agentPath = input.agentPath;
      if (typeof agentPath === "string" && agentPath.trim() !== "") {
        try {
          agentPath = resolveProjectPath(agentPath.trim());
        } catch (err) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: err instanceof Error ? err.message : "invalid project folder",
          });
        }
      } else if (agentPath !== undefined) {
        agentPath = null;
      }
      return boardRepo.updateBoard(ctx.db, board.id, {
        name: input.name,
        visibility: input.visibility,
        agentPath,
        agentVerifyCommand:
          input.agentVerifyCommand === undefined
            ? undefined
            : input.agentVerifyCommand?.trim() || null,
      });
    }),

  delete: protectedProcedure
    .input(z.object({ boardPublicId: z.string().length(12) }))
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
        "board:delete",
      );
      await boardRepo.softDeleteBoard(ctx.db, board.id);
      return { success: true };
    }),
});
