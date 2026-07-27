import { z } from "zod";

import { webhookRepo } from "@kr8kan/db";

type Webhook = Awaited<
  ReturnType<typeof webhookRepo.listWebhooks>
>[number];

import { assertPermission, notFound } from "../permissions";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { requireWorkspaceByPublicId } from "./workspace";

/**
 * Strips the signing secret out of a webhook row for list/update/delete
 * responses. `hasSecret` tells the UI whether signing is active;
 * `secretPreview` (first 6 chars + "…") lets an operator eyeball which
 * secret is configured without ever re-exposing the full value. The full
 * secret is only ever returned once, from `create` and `rotateSecret`.
 */
function toPublicWebhook(row: Webhook) {
  const { signingSecret, ...rest } = row;
  return {
    ...rest,
    hasSecret: Boolean(signingSecret),
    secretPreview: signingSecret ? `${signingSecret.slice(0, 6)}…` : null,
  };
}

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
      const hooks = await webhookRepo.listWebhooks(ctx.db, workspace.id);
      return hooks.map(toPublicWebhook);
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
      const hook = await webhookRepo.createWebhook(ctx.db, {
        workspaceId: workspace.id,
        url: input.url,
        events: input.events,
        createdBy: ctx.user.id,
      });
      // Secret is only ever visible in this one response — store it now.
      return { ...toPublicWebhook(hook), secret: hook.signingSecret };
    }),

  rotateSecret: protectedProcedure
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
      const rotated = await webhookRepo.rotateWebhookSecret(
        ctx.db,
        webhook.id,
      );
      if (!rotated) notFound("webhook");
      // Like create, the plaintext secret is only ever visible here.
      return { ...toPublicWebhook(rotated), secret: rotated.signingSecret };
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
      const updated = await webhookRepo.updateWebhook(ctx.db, webhook.id, {
        url: input.url,
        events: input.events,
        enabled: input.enabled,
      });
      if (!updated) notFound("webhook");
      return toPublicWebhook(updated);
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
