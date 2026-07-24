import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { workspaceRepo } from "@kr8kan/db";

import { assertPermission, notFound } from "../permissions";
import { createTRPCRouter, protectedProcedure } from "../trpc";

export const workspaceRouter = createTRPCRouter({
  list: protectedProcedure
    .meta({
      openapi: { method: "GET", path: "/workspaces", tags: ["workspace"] },
    })
    .input(z.void())
    .output(z.any())
    .query(({ ctx }) =>
      workspaceRepo.listWorkspacesForUser(ctx.db, ctx.user.id),
    ),

  byPublicId: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/workspaces/{workspacePublicId}",
        tags: ["workspace"],
      },
    })
    .input(z.object({ workspacePublicId: z.string().length(12) }))
    .output(z.any())
    .query(async ({ ctx, input }) => {
      const workspace = await workspaceRepo.getWorkspaceByPublicId(
        ctx.db,
        input.workspacePublicId,
      );
      if (!workspace) notFound("workspace");
      await assertPermission(ctx.db, ctx.user.id, workspace.id, "workspace:view");
      return workspace;
    }),

  create: protectedProcedure
    .meta({
      openapi: { method: "POST", path: "/workspaces", tags: ["workspace"] },
    })
    .input(
      z.object({
        name: z.string().min(1).max(120),
        description: z.string().max(500).optional(),
      }),
    )
    .output(z.any())
    .mutation(({ ctx, input }) =>
      workspaceRepo.createWorkspace(ctx.db, {
        name: input.name,
        description: input.description,
        userId: ctx.user.id,
      }),
    ),

  update: protectedProcedure
    .input(
      z.object({
        workspacePublicId: z.string().length(12),
        name: z.string().min(1).max(120).optional(),
        description: z.string().max(500).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const workspace = await workspaceRepo.getWorkspaceByPublicId(
        ctx.db,
        input.workspacePublicId,
      );
      if (!workspace) notFound("workspace");
      await assertPermission(ctx.db, ctx.user.id, workspace.id, "workspace:edit");
      return workspaceRepo.updateWorkspace(ctx.db, workspace.id, {
        name: input.name,
        description: input.description,
      });
    }),

  delete: protectedProcedure
    .input(z.object({ workspacePublicId: z.string().length(12) }))
    .mutation(async ({ ctx, input }) => {
      const workspace = await workspaceRepo.getWorkspaceByPublicId(
        ctx.db,
        input.workspacePublicId,
      );
      if (!workspace) notFound("workspace");
      await assertPermission(
        ctx.db,
        ctx.user.id,
        workspace.id,
        "workspace:delete",
      );
      await workspaceRepo.softDeleteWorkspace(ctx.db, workspace.id);
      return { success: true };
    }),
});

export async function requireWorkspaceByPublicId(
  db: Parameters<typeof workspaceRepo.getWorkspaceByPublicId>[0],
  publicId: string,
) {
  const workspace = await workspaceRepo.getWorkspaceByPublicId(db, publicId);
  if (!workspace) {
    throw new TRPCError({ code: "NOT_FOUND", message: "workspace not found" });
  }
  return workspace;
}
