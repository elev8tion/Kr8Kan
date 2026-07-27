import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { cardRepo } from "@kr8kan/db";
import { createLogger } from "@kr8kan/logger";
import {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  WORKSPACE_ROLES,
  generateUID,
} from "@kr8kan/shared";

import { audit } from "../audit";
import { assertPermission, notFound } from "../permissions";
import {
  S3_UNCONFIGURED_MESSAGE,
  deleteObject,
  presignGet,
  presignPut,
  s3Configured,
} from "../s3";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";

const logger = createLogger("api");

export const healthRouter = createTRPCRouter({
  check: publicProcedure
    .meta({ openapi: { method: "GET", path: "/health", tags: ["health"] } })
    .input(z.void())
    .output(z.object({ status: z.string(), version: z.string() }))
    .query(() => ({ status: "ok", version: "0.1.0" })),
});

export const feedbackRouter = createTRPCRouter({
  // Self-host: feedback goes to the operator's own logs, not a vendor.
  create: protectedProcedure
    .input(z.object({ feedback: z.string().min(1).max(5000) }))
    .mutation(({ ctx, input }) => {
      logger.info(
        { user: ctx.user.email, feedback: input.feedback },
        "feedback received",
      );
      return { success: true };
    }),
});

export const permissionRouter = createTRPCRouter({
  matrix: protectedProcedure.input(z.void()).query(() => ({
    roles: WORKSPACE_ROLES,
    permissions: PERMISSIONS,
    rolePermissions: ROLE_PERMISSIONS,
  })),
});

export const integrationRouter = createTRPCRouter({
  // Placeholder surface: self-host integrations are webhooks + MCP + REST.
  list: protectedProcedure.input(z.void()).query(() => ({
    integrations: [
      {
        key: "webhooks",
        name: "Workspace webhooks",
        status: "available",
        detail: "POST card events to any local or remote URL.",
      },
      {
        key: "mcp",
        name: "MCP server (@kr8kan/mcp)",
        status: "available",
        detail: "Expose boards/cards as MCP tools against the local REST API.",
      },
      {
        key: "pi-workers",
        name: "Pi AI workers",
        status: "available",
        detail: "Board/card automation via your global ~/.pi agent layer.",
      },
    ],
  })),
});

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export const attachmentRouter = createTRPCRouter({
  // Uploads require S3-compatible storage (optional infra). Without it the
  // endpoints exist but report storage as unconfigured — honestly.
  storageStatus: protectedProcedure.input(z.void()).query(() => ({
    configured: s3Configured(),
  })),

  presign: protectedProcedure
    .input(
      z.object({
        cardPublicId: z.string().length(12),
        filename: z.string().min(1).max(255),
        contentType: z.string().max(127).optional(),
        size: z.number().int().min(1).max(MAX_ATTACHMENT_BYTES),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!s3Configured()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: S3_UNCONFIGURED_MESSAGE,
        });
      }
      const card = await cardRepo.getCardWithBoard(ctx.db, input.cardPublicId);
      if (!card) notFound("card");
      await assertPermission(
        ctx.db,
        ctx.user.id,
        card.list.board.workspaceId,
        "card:edit",
      );
      const safeName = input.filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
      const key = `attachments/${card.publicId}/${generateUID(16)}-${safeName}`;
      const attachment = await cardRepo.createAttachment(ctx.db, {
        cardId: card.id,
        filename: input.filename,
        key,
        contentType: input.contentType,
        size: input.size,
        userId: ctx.user.id,
      });
      const uploadUrl = await presignPut(
        key,
        input.contentType ?? "application/octet-stream",
      );
      return { attachmentPublicId: attachment?.publicId, uploadUrl };
    }),

  getUrl: protectedProcedure
    .input(z.object({ attachmentPublicId: z.string().length(12) }))
    .mutation(async ({ ctx, input }) => {
      if (!s3Configured()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: S3_UNCONFIGURED_MESSAGE,
        });
      }
      const attachment = await cardRepo.getAttachmentByPublicId(
        ctx.db,
        input.attachmentPublicId,
      );
      if (!attachment) notFound("attachment");
      await assertPermission(
        ctx.db,
        ctx.user.id,
        attachment.card.list.board.workspaceId,
        "card:view",
      );
      return { url: await presignGet(attachment.key, attachment.filename) };
    }),

  delete: protectedProcedure
    .input(z.object({ attachmentPublicId: z.string().length(12) }))
    .mutation(async ({ ctx, input }) => {
      const attachment = await cardRepo.getAttachmentByPublicId(
        ctx.db,
        input.attachmentPublicId,
      );
      if (!attachment) notFound("attachment");
      const workspaceId = attachment.card.list.board.workspaceId;
      const membership = await assertPermission(
        ctx.db,
        ctx.user.id,
        workspaceId,
        "card:edit",
      );
      if (
        attachment.createdBy !== ctx.user.id &&
        membership.role !== "admin"
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the uploader or a workspace admin can delete this",
        });
      }
      await cardRepo.softDeleteAttachment(ctx.db, attachment.id);
      if (s3Configured()) await deleteObject(attachment.key);
      audit(ctx.db, {
        workspaceId,
        eventType: "attachment.deleted",
        entityType: "attachment",
        entityPublicId: attachment.publicId,
        actorUserId: ctx.user.id,
        payload: { filename: attachment.filename },
      });
      return { success: true };
    }),
});
