import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { boardRepo, cardRepo, cardTemplateRepo, workspaceRepo } from "@kr8kan/db";

import { audit } from "../audit";
import { assertPermission, notFound } from "../permissions";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * cardTemplate.* — reusable card shapes (bug report, release checklist).
 * Templates are workspace-scoped; label names resolve against the target
 * board at instantiation time.
 */

async function requireWorkspace(
  ctx: { db: Parameters<typeof workspaceRepo.getWorkspaceByPublicId>[0]; user: { id: string } },
  workspacePublicId: string,
  permission: Parameters<typeof assertPermission>[3],
) {
  const workspace = await workspaceRepo.getWorkspaceByPublicId(
    ctx.db,
    workspacePublicId,
  );
  if (!workspace) notFound("workspace");
  await assertPermission(ctx.db, ctx.user.id, workspace.id, permission);
  return workspace;
}

async function requireTemplate(
  ctx: { db: Parameters<typeof cardTemplateRepo.getTemplateByPublicId>[0]; user: { id: string } },
  templatePublicId: string,
  permission: Parameters<typeof assertPermission>[3],
) {
  const template = await cardTemplateRepo.getTemplateByPublicId(
    ctx.db,
    templatePublicId,
  );
  if (!template) notFound("template");
  try {
    await assertPermission(ctx.db, ctx.user.id, template.workspaceId, permission);
  } catch {
    notFound("template");
  }
  return template;
}

export const cardTemplateRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ workspacePublicId: z.string().length(12) }))
    .query(async ({ ctx, input }) => {
      const workspace = await requireWorkspace(
        ctx,
        input.workspacePublicId,
        "card:view",
      );
      const rows = await cardTemplateRepo.listTemplates(ctx.db, workspace.id);
      return rows.map((t) => ({
        publicId: t.publicId,
        name: t.name,
        title: t.title,
        description: t.description,
        checklist: t.checklist,
        labels: t.labels,
        createdBy: t.createdBy,
        authorName: t.author?.name ?? null,
        createdAt: t.createdAt,
      }));
    }),

  create: protectedProcedure
    .input(
      z.object({
        workspacePublicId: z.string().length(12),
        name: z.string().min(1).max(120),
        /** Snapshot an existing card instead of passing fields. */
        fromCardPublicId: z.string().length(12).optional(),
        title: z.string().min(1).max(500).optional(),
        description: z.string().max(20_000).nullish(),
        checklist: z.array(z.string().min(1).max(500)).max(50).optional(),
        labels: z.array(z.string().min(1).max(80)).max(20).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const workspace = await requireWorkspace(
        ctx,
        input.workspacePublicId,
        "card:create",
      );

      let title = input.title;
      let description = input.description ?? undefined;
      let checklist = input.checklist ?? [];
      let labels = input.labels ?? [];

      if (input.fromCardPublicId) {
        const card = await cardRepo.getCardByPublicId(
          ctx.db,
          input.fromCardPublicId,
        );
        if (!card || card.list.board.workspaceId !== workspace.id) {
          notFound("card");
        }
        title = card.title;
        description = card.description ?? undefined;
        // First checklist only — templates carry one flat item list.
        checklist = (card.checklists[0]?.items ?? []).map((i) => i.title);
        labels = card.labels.map((cl) => cl.label.name);
      }
      if (!title) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "provide a title or fromCardPublicId",
        });
      }

      const existing = await cardTemplateRepo.listTemplates(ctx.db, workspace.id);
      if (existing.some((t) => t.name.toLowerCase() === input.name.toLowerCase())) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `a template named "${input.name}" already exists`,
        });
      }

      const template = await cardTemplateRepo.createTemplate(ctx.db, {
        workspaceId: workspace.id,
        name: input.name,
        title,
        description,
        checklist,
        labels,
        createdBy: ctx.user.id,
      });
      audit(ctx.db, {
        workspaceId: workspace.id,
        eventType: "card.template.created",
        entityType: "card_template",
        entityPublicId: template?.publicId,
        actorUserId: ctx.user.id,
        payload: { name: input.name, fromCard: input.fromCardPublicId ?? null },
      });
      return template;
    }),

  update: protectedProcedure
    .input(
      z.object({
        templatePublicId: z.string().length(12),
        name: z.string().min(1).max(120).optional(),
        title: z.string().min(1).max(500).optional(),
        description: z.string().max(20_000).nullish(),
        checklist: z.array(z.string().min(1).max(500)).max(50).optional(),
        labels: z.array(z.string().min(1).max(80)).max(20).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const template = await requireTemplate(
        ctx,
        input.templatePublicId,
        "card:edit",
      );
      if (template.createdBy !== ctx.user.id) {
        const membership = await workspaceRepo.getMembership(
          ctx.db,
          ctx.user.id,
          template.workspaceId,
        );
        if (membership?.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only the template's creator or an admin can edit it",
          });
        }
      }
      return cardTemplateRepo.updateTemplate(ctx.db, template.id, {
        name: input.name,
        title: input.title,
        description: input.description,
        checklist: input.checklist,
        labels: input.labels,
      });
    }),

  delete: protectedProcedure
    .input(z.object({ templatePublicId: z.string().length(12) }))
    .mutation(async ({ ctx, input }) => {
      const template = await requireTemplate(
        ctx,
        input.templatePublicId,
        "card:edit",
      );
      if (template.createdBy !== ctx.user.id) {
        const membership = await workspaceRepo.getMembership(
          ctx.db,
          ctx.user.id,
          template.workspaceId,
        );
        if (membership?.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only the template's creator or an admin can delete it",
          });
        }
      }
      await cardTemplateRepo.softDeleteTemplate(ctx.db, template.id);
      audit(ctx.db, {
        workspaceId: template.workspaceId,
        eventType: "card.template.deleted",
        entityType: "card_template",
        entityPublicId: template.publicId,
        actorUserId: ctx.user.id,
      });
      return { success: true };
    }),

  instantiate: protectedProcedure
    .input(
      z.object({
        templatePublicId: z.string().length(12),
        listPublicId: z.string().length(12),
        title: z.string().min(1).max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const template = await requireTemplate(
        ctx,
        input.templatePublicId,
        "card:create",
      );
      const list = await boardRepo.getListByPublicId(ctx.db, input.listPublicId);
      if (!list || list.board.workspaceId !== template.workspaceId) {
        notFound("list");
      }

      const card = await cardRepo.createCard(ctx.db, {
        listId: list.id,
        title: input.title ?? template.title,
        description: template.description ?? undefined,
        userId: ctx.user.id,
      });

      if (template.checklist.length) {
        const checklist = await cardRepo.createChecklist(ctx.db, {
          cardId: card.id,
          name: template.name,
        });
        for (const item of template.checklist) {
          await cardRepo.addChecklistItem(ctx.db, {
            checklistId: checklist!.id,
            title: item,
          });
        }
      }

      // Labels are board-scoped: resolve template label names against the
      // target board case-insensitively; misses are skipped and reported.
      const skippedLabels: string[] = [];
      if (template.labels.length) {
        const boardLabels = await boardRepo.listLabelsByBoard(
          ctx.db,
          list.boardId,
        );
        const byName = new Map(
          boardLabels.map((l) => [l.name.toLowerCase(), l]),
        );
        for (const name of template.labels) {
          const label = byName.get(name.toLowerCase());
          if (label) {
            await cardRepo.addLabelToCard(ctx.db, card.id, label.id, ctx.user.id);
          } else {
            skippedLabels.push(name);
          }
        }
      }

      await cardRepo.recordActivity(ctx.db, {
        cardId: card.id,
        type: "card.template.instantiated",
        userId: ctx.user.id,
        metadata: { template: template.name },
      });
      audit(ctx.db, {
        workspaceId: template.workspaceId,
        eventType: "card.template.instantiated",
        entityType: "card",
        entityPublicId: card.publicId,
        actorUserId: ctx.user.id,
        payload: { template: template.name, skippedLabels },
      });
      return { card, skippedLabels };
    }),
});
