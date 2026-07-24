import { z } from "zod";

import { webhookRepo } from "@kr8kan/db";

import { assertPermission, notFound } from "../permissions";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { requireWorkspaceByPublicId } from "./workspace";

export const webhookRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ workspacePublicId: z.string().length(12) }))
    .query(async ({ ctx, input }) => {
      const workspace = await requireWorkspaceByPublicId(
        ctx.db,
        input.workspacePublicId,
      );
      await assertPermission(
        ctx.db,
        ctx.user.id,
        workspace.id,
        "webhook:manage",
      );
      return webhookRepo.listWebhooks(ctx.db, workspace.id);
    }),

  create: protectedProcedure
    .input(
      z.object({
        workspacePublicId: z.string().length(12),
        url: z.string().url().max(2000),
        events: z.array(z.string().max(64)).max(20).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const workspace = await requireWorkspaceByPublicId(
        ctx.db,
        input.workspacePublicId,
      );
      await assertPermission(
        ctx.db,
        ctx.user.id,
        workspace.id,
        "webhook:manage",
      );
      return webhookRepo.createWebhook(ctx.db, {
        workspaceId: workspace.id,
        url: input.url,
        events: input.events,
        createdBy: ctx.user.id,
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        webhookPublicId: z.string().length(12),
        url: z.string().url().max(2000).optional(),
        events: z.array(z.string().max(64)).max(20).optional(),
        enabled: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const webhook = await webhookRepo.getWebhookByPublicId(
        ctx.db,
        input.webhookPublicId,
      );
      if (!webhook) notFound("webhook");
      await assertPermission(
        ctx.db,
        ctx.user.id,
        webhook.workspaceId,
        "webhook:manage",
      );
      return webhookRepo.updateWebhook(ctx.db, webhook.id, {
        url: input.url,
        events: input.events,
        enabled: input.enabled,
      });
    }),

  delete: protectedProcedure
    .input(z.object({ webhookPublicId: z.string().length(12) }))
    .mutation(async ({ ctx, input }) => {
      const webhook = await webhookRepo.getWebhookByPublicId(
        ctx.db,
        input.webhookPublicId,
      );
      if (!webhook) notFound("webhook");
      await assertPermission(
        ctx.db,
        ctx.user.id,
        webhook.workspaceId,
        "webhook:manage",
      );
      await webhookRepo.softDeleteWebhook(ctx.db, webhook.id);
      return { success: true };
    }),
});
