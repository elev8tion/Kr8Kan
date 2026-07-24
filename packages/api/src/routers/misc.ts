import { z } from "zod";

import { createLogger } from "@kr8kan/logger";
import { PERMISSIONS, ROLE_PERMISSIONS, WORKSPACE_ROLES } from "@kr8kan/shared";

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

export const importRouter = createTRPCRouter({
  // Trello import is optional per spec; the surface exists, the parser can land later.
  trello: protectedProcedure
    .input(z.object({ workspacePublicId: z.string().length(12) }))
    .mutation(() => {
      return {
        started: false,
        message:
          "Trello import is not implemented yet on this instance. Export your Trello board as JSON and create cards via the REST API in the meantime.",
      };
    }),
});

export const attachmentRouter = createTRPCRouter({
  // Uploads require S3-compatible storage (optional infra). Without it the
  // endpoints exist but report storage as unconfigured.
  storageStatus: protectedProcedure.input(z.void()).query(() => ({
    configured: Boolean(process.env.S3_ENDPOINT && process.env.S3_BUCKET),
  })),
});
