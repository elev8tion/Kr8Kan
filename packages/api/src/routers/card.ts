import { z } from "zod";

import { boardRepo, cardRepo } from "@kr8kan/db";

import { assertPermission, notFound } from "../permissions";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { dispatchWebhookEvent } from "../webhooks";

async function requireCard(
  ctx: { db: Parameters<typeof cardRepo.getCardWithBoard>[0]; user: { id: string } },
  cardPublicId: string,
  permission: Parameters<typeof assertPermission>[3],
) {
  const card = await cardRepo.getCardWithBoard(ctx.db, cardPublicId);
  if (!card) notFound("card");
  await assertPermission(
    ctx.db,
    ctx.user.id,
    card.list.board.workspaceId,
    permission,
  );
  return card;
}

export const cardRouter = createTRPCRouter({
  byPublicId: protectedProcedure
    .meta({
      openapi: { method: "GET", path: "/cards/{cardPublicId}", tags: ["card"] },
    })
    .input(z.object({ cardPublicId: z.string().length(12) }))
    .output(z.any())
    .query(async ({ ctx, input }) => {
      await requireCard(ctx, input.cardPublicId, "card:view");
      return cardRepo.getCardByPublicId(ctx.db, input.cardPublicId);
    }),

  create: protectedProcedure
    .meta({
      openapi: { method: "POST", path: "/cards", tags: ["card"] },
    })
    .input(
      z.object({
        listPublicId: z.string().length(12),
        title: z.string().min(1).max(500),
        description: z.string().max(20_000).optional(),
      }),
    )
    .output(z.any())
    .mutation(async ({ ctx, input }) => {
      const list = await boardRepo.getListByPublicId(ctx.db, input.listPublicId);
      if (!list) notFound("list");
      await assertPermission(
        ctx.db,
        ctx.user.id,
        list.board.workspaceId,
        "card:create",
      );
      const card = await cardRepo.createCard(ctx.db, {
        listId: list.id,
        title: input.title,
        description: input.description,
        userId: ctx.user.id,
      });
      dispatchWebhookEvent(ctx.db, list.board.workspaceId, "card.created", {
        card: { publicId: card.publicId, title: card.title },
        board: { publicId: list.board.publicId, name: list.board.name },
        list: { publicId: list.publicId, name: list.name },
      });
      return card;
    }),

  update: protectedProcedure
    .meta({
      openapi: { method: "PUT", path: "/cards/{cardPublicId}", tags: ["card"] },
    })
    .input(
      z.object({
        cardPublicId: z.string().length(12),
        title: z.string().min(1).max(500).optional(),
        description: z.string().max(20_000).nullish(),
        dueDate: z.coerce.date().nullish(),
      }),
    )
    .output(z.any())
    .mutation(async ({ ctx, input }) => {
      const card = await requireCard(ctx, input.cardPublicId, "card:edit");
      return cardRepo.updateCard(
        ctx.db,
        card.id,
        {
          title: input.title,
          description: input.description,
          dueDate: input.dueDate,
        },
        ctx.user.id,
      );
    }),

  move: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/cards/{cardPublicId}/move",
        tags: ["card"],
      },
    })
    .input(
      z.object({
        cardPublicId: z.string().length(12),
        toListPublicId: z.string().length(12),
        position: z.number().int().min(0).max(10_000),
      }),
    )
    .output(z.any())
    .mutation(async ({ ctx, input }) => {
      const card = await requireCard(ctx, input.cardPublicId, "card:move");
      const toList = await boardRepo.getListByPublicId(
        ctx.db,
        input.toListPublicId,
      );
      if (!toList) notFound("list");
      if (toList.board.workspaceId !== card.list.board.workspaceId) {
        notFound("list");
      }
      const moved = await cardRepo.moveCard(ctx.db, {
        cardId: card.id,
        toListId: toList.id,
        position: input.position,
        userId: ctx.user.id,
      });
      dispatchWebhookEvent(ctx.db, toList.board.workspaceId, "card.moved", {
        card: { publicId: card.publicId, title: card.title },
        toList: { publicId: toList.publicId, name: toList.name },
      });
      return moved;
    }),

  delete: protectedProcedure
    .meta({
      openapi: {
        method: "DELETE",
        path: "/cards/{cardPublicId}",
        tags: ["card"],
      },
    })
    .input(z.object({ cardPublicId: z.string().length(12) }))
    .output(z.any())
    .mutation(async ({ ctx, input }) => {
      const card = await requireCard(ctx, input.cardPublicId, "card:delete");
      await cardRepo.softDeleteCard(ctx.db, card.id);
      return { success: true };
    }),

  /* labels */
  addLabel: protectedProcedure
    .input(
      z.object({
        cardPublicId: z.string().length(12),
        labelPublicId: z.string().length(12),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const card = await requireCard(ctx, input.cardPublicId, "card:edit");
      const label = await boardRepo.getLabelByPublicId(
        ctx.db,
        input.labelPublicId,
      );
      if (!label || label.boardId !== card.list.boardId) notFound("label");
      await cardRepo.addLabelToCard(ctx.db, card.id, label.id, ctx.user.id);
      return { success: true };
    }),

  removeLabel: protectedProcedure
    .input(
      z.object({
        cardPublicId: z.string().length(12),
        labelPublicId: z.string().length(12),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const card = await requireCard(ctx, input.cardPublicId, "card:edit");
      const label = await boardRepo.getLabelByPublicId(
        ctx.db,
        input.labelPublicId,
      );
      if (!label) notFound("label");
      await cardRepo.removeLabelFromCard(ctx.db, card.id, label.id);
      return { success: true };
    }),

  /* members */
  addMember: protectedProcedure
    .input(
      z.object({
        cardPublicId: z.string().length(12),
        memberPublicId: z.string().length(12),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const card = await requireCard(ctx, input.cardPublicId, "card:edit");
      const { workspaceRepo } = await import("@kr8kan/db");
      const member = await workspaceRepo.getMemberByPublicId(
        ctx.db,
        input.memberPublicId,
      );
      if (!member || member.workspaceId !== card.list.board.workspaceId) {
        notFound("member");
      }
      await cardRepo.addMemberToCard(ctx.db, card.id, member.id, ctx.user.id);
      return { success: true };
    }),

  removeMember: protectedProcedure
    .input(
      z.object({
        cardPublicId: z.string().length(12),
        memberPublicId: z.string().length(12),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const card = await requireCard(ctx, input.cardPublicId, "card:edit");
      const { workspaceRepo } = await import("@kr8kan/db");
      const member = await workspaceRepo.getMemberByPublicId(
        ctx.db,
        input.memberPublicId,
      );
      if (!member) notFound("member");
      await cardRepo.removeMemberFromCard(ctx.db, card.id, member.id);
      return { success: true };
    }),

  /* comments */
  addComment: protectedProcedure
    .input(
      z.object({
        cardPublicId: z.string().length(12),
        comment: z.string().min(1).max(10_000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const card = await requireCard(ctx, input.cardPublicId, "card:comment");
      return cardRepo.addComment(ctx.db, {
        cardId: card.id,
        comment: input.comment,
        userId: ctx.user.id,
      });
    }),

  updateComment: protectedProcedure
    .input(
      z.object({
        commentPublicId: z.string().length(12),
        comment: z.string().min(1).max(10_000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const comment = await cardRepo.getCommentByPublicId(
        ctx.db,
        input.commentPublicId,
      );
      if (!comment || comment.createdBy !== ctx.user.id) notFound("comment");
      return cardRepo.updateComment(ctx.db, comment.id, input.comment);
    }),

  deleteComment: protectedProcedure
    .input(z.object({ commentPublicId: z.string().length(12) }))
    .mutation(async ({ ctx, input }) => {
      const comment = await cardRepo.getCommentByPublicId(
        ctx.db,
        input.commentPublicId,
      );
      if (!comment || comment.createdBy !== ctx.user.id) notFound("comment");
      await cardRepo.softDeleteComment(ctx.db, comment.id);
      return { success: true };
    }),
});
