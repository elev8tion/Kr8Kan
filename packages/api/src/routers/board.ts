import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { resolveProjectPath } from "@kr8kan/agents";
import { boardNoteRepo, boardRepo, channelRepo } from "@kr8kan/db";
import { slugify } from "@kr8kan/shared";

import { audit } from "../audit";
import { assertPermission, notFound } from "../permissions";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
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

  /**
   * Unauthenticated read-only view of a `visibility: public` board.
   * Explicitly redacted shape — no members, comments, agent config, or
   * workspace internals ever leave this endpoint.
   */
  publicView: publicProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/public/boards/{boardPublicId}",
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
      if (!board || board.visibility !== "public") notFound("board");
      return {
        publicId: board.publicId,
        name: board.name,
        workspaceName: board.workspace.name,
        lists: board.lists.map((list) => ({
          publicId: list.publicId,
          name: list.name,
          cards: list.cards.map((card) => {
            const items = card.checklists.flatMap((cl) => cl.items);
            return {
              publicId: card.publicId,
              title: card.title,
              description: card.description,
              dueDate: card.dueDate?.toISOString() ?? null,
              labels: card.labels.map((cl) => ({
                name: cl.label.name,
                colourCode: cl.label.colourCode,
              })),
              checklistDone: items.filter((i) => i.completed).length,
              checklistTotal: items.length,
            };
          }),
        })),
      };
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
        /** Offer, never force: also create a companion #channel. */
        withChannel: z.boolean().optional(),
      }),
    )
    .output(z.any())
    .mutation(async ({ ctx, input }) => {
      const workspace = await requireWorkspaceByPublicId(
        ctx.db,
        input.workspacePublicId,
      );
      await assertPermission(ctx.db, ctx.user.id, workspace.id, "board:create");
      const board = await boardRepo.createBoard(ctx.db, {
        workspaceId: workspace.id,
        name: input.name,
        userId: ctx.user.id,
        defaultLists: input.defaultLists ?? ["To do", "Doing", "Done"],
      });
      if (input.withChannel && board) {
        // Slug collisions just skip the companion — board creation is
        // the primary act and must not fail over a channel name.
        const slug = slugify(input.name) || "channel";
        const existing = await channelRepo.listChannels(ctx.db, workspace.id);
        if (!existing.some((c) => c.slug === slug)) {
          const channel = await channelRepo.createChannel(ctx.db, {
            workspaceId: workspace.id,
            name: input.name,
            slug,
            boardId: board.id,
            userId: ctx.user.id,
          });
          audit(ctx.db, {
            workspaceId: workspace.id,
            eventType: "channel.created",
            entityType: "channel",
            entityPublicId: channel?.publicId,
            actorUserId: ctx.user.id,
            payload: { name: input.name, board: board.publicId },
          });
        }
      }
      return board;
    }),

  update: protectedProcedure
    .input(
      z.object({
        boardPublicId: z.string().length(12),
        name: z.string().min(1).max(160).optional(),
        visibility: z.enum(["private", "public"]).optional(),
        agentPath: z.string().max(500).nullish(),
        agentVerifyCommand: z.string().max(500).nullish(),
        agentBrowserUrl: z.string().max(500).nullish(),
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
      // Shape check only. Whether the host is actually reachable is the
      // browser's call at run time, against KR8KAN_BROWSER_ALLOWED_HOSTS —
      // saving a URL here grants nothing on its own.
      let agentBrowserUrl = input.agentBrowserUrl?.trim() || null;
      if (agentBrowserUrl !== null && input.agentBrowserUrl !== undefined) {
        if (!/^https?:\/\//i.test(agentBrowserUrl)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "dev URL must start with http:// or https://",
          });
        }
        try {
          agentBrowserUrl = new URL(agentBrowserUrl).toString();
        } catch {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "dev URL is not a valid URL",
          });
        }
      }

      const updated = await boardRepo.updateBoard(ctx.db, board.id, {
        name: input.name,
        visibility: input.visibility,
        agentPath,
        agentVerifyCommand:
          input.agentVerifyCommand === undefined
            ? undefined
            : input.agentVerifyCommand?.trim() || null,
        agentBrowserUrl:
          input.agentBrowserUrl === undefined ? undefined : agentBrowserUrl,
      });
      if (input.visibility && input.visibility !== board.visibility) {
        audit(ctx.db, {
          workspaceId: board.workspaceId,
          eventType: "board.visibility.changed",
          entityType: "board",
          entityPublicId: board.publicId,
          actorUserId: ctx.user.id,
          payload: { visibility: input.visibility },
        });
      }
      return updated;
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

  /* ── board notes: one markdown doc per board ─────────────────── */

  getNote: protectedProcedure
    .input(z.object({ boardPublicId: z.string().length(12) }))
    .query(async ({ ctx, input }) => {
      const board = await boardRepo.getBoardByPublicId(
        ctx.db,
        input.boardPublicId,
      );
      if (!board) notFound("board");
      await assertPermission(ctx.db, ctx.user.id, board.workspaceId, "board:view");
      return (await boardNoteRepo.getNote(ctx.db, board.id)) ?? null;
    }),

  updateNote: protectedProcedure
    .input(
      z.object({
        boardPublicId: z.string().length(12),
        content: z.string().max(50_000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const board = await boardRepo.getBoardByPublicId(
        ctx.db,
        input.boardPublicId,
      );
      if (!board) notFound("board");
      await assertPermission(ctx.db, ctx.user.id, board.workspaceId, "board:edit");
      const note = await boardNoteRepo.upsertNote(ctx.db, {
        boardId: board.id,
        content: input.content,
        userId: ctx.user.id,
      });
      audit(ctx.db, {
        workspaceId: board.workspaceId,
        eventType: "board.note.updated",
        entityType: "board",
        entityPublicId: board.publicId,
        actorUserId: ctx.user.id,
        payload: { length: input.content.length },
      });
      return note;
    }),
});
