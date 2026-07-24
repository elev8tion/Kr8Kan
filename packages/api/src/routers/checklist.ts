import { z } from "zod";

import { cardRepo } from "@kr8kan/db";

import { assertPermission, notFound } from "../permissions";
import { createTRPCRouter, protectedProcedure } from "../trpc";

async function requireCardForChecklist(
  ctx: { db: Parameters<typeof cardRepo.getCardWithBoard>[0]; user: { id: string } },
  cardPublicId: string,
) {
  const card = await cardRepo.getCardWithBoard(ctx.db, cardPublicId);
  if (!card) notFound("card");
  await assertPermission(
    ctx.db,
    ctx.user.id,
    card.list.board.workspaceId,
    "card:edit",
  );
  return card;
}

export const checklistRouter = createTRPCRouter({
  create: protectedProcedure
    .input(
      z.object({
        cardPublicId: z.string().length(12),
        name: z.string().min(1).max(160),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const card = await requireCardForChecklist(ctx, input.cardPublicId);
      return cardRepo.createChecklist(ctx.db, {
        cardId: card.id,
        name: input.name,
      });
    }),

  delete: protectedProcedure
    .input(z.object({ checklistPublicId: z.string().length(12) }))
    .mutation(async ({ ctx, input }) => {
      const checklist = await cardRepo.getChecklistByPublicId(
        ctx.db,
        input.checklistPublicId,
      );
      if (!checklist) notFound("checklist");
      const card = await cardRepo.getCardWithBoard(ctx.db, checklist.card.publicId);
      if (!card) notFound("card");
      await assertPermission(
        ctx.db,
        ctx.user.id,
        card.list.board.workspaceId,
        "card:edit",
      );
      await cardRepo.softDeleteChecklist(ctx.db, checklist.id);
      return { success: true };
    }),

  addItem: protectedProcedure
    .input(
      z.object({
        checklistPublicId: z.string().length(12),
        title: z.string().min(1).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const checklist = await cardRepo.getChecklistByPublicId(
        ctx.db,
        input.checklistPublicId,
      );
      if (!checklist) notFound("checklist");
      const card = await cardRepo.getCardWithBoard(ctx.db, checklist.card.publicId);
      if (!card) notFound("card");
      await assertPermission(
        ctx.db,
        ctx.user.id,
        card.list.board.workspaceId,
        "card:edit",
      );
      return cardRepo.addChecklistItem(ctx.db, {
        checklistId: checklist.id,
        title: input.title,
      });
    }),

  updateItem: protectedProcedure
    .input(
      z.object({
        itemPublicId: z.string().length(12),
        title: z.string().min(1).max(500).optional(),
        completed: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const item = await cardRepo.getChecklistItemByPublicId(
        ctx.db,
        input.itemPublicId,
      );
      if (!item) notFound("checklist item");
      const card = await cardRepo.getCardWithBoard(
        ctx.db,
        item.checklist.card.publicId,
      );
      if (!card) notFound("card");
      await assertPermission(
        ctx.db,
        ctx.user.id,
        card.list.board.workspaceId,
        "card:edit",
      );
      return cardRepo.updateChecklistItem(ctx.db, item.id, {
        title: input.title,
        completed: input.completed,
      });
    }),

  deleteItem: protectedProcedure
    .input(z.object({ itemPublicId: z.string().length(12) }))
    .mutation(async ({ ctx, input }) => {
      const item = await cardRepo.getChecklistItemByPublicId(
        ctx.db,
        input.itemPublicId,
      );
      if (!item) notFound("checklist item");
      const card = await cardRepo.getCardWithBoard(
        ctx.db,
        item.checklist.card.publicId,
      );
      if (!card) notFound("card");
      await assertPermission(
        ctx.db,
        ctx.user.id,
        card.list.board.workspaceId,
        "card:edit",
      );
      await cardRepo.softDeleteChecklistItem(ctx.db, item.id);
      return { success: true };
    }),
});
