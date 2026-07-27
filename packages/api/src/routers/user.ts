import { z } from "zod";

import { workspaceRepo } from "@kr8kan/db";

import { createTRPCRouter, protectedProcedure } from "../trpc";

export const userRouter = createTRPCRouter({
  me: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/me", tags: ["user"] } })
    .input(z.void())
    .output(z.any())
    .query(async ({ ctx }) => {
      const workspaces = await workspaceRepo.listWorkspacesForUser(
        ctx.db,
        ctx.user.id,
      );
      return {
        user: {
          id: ctx.user.id,
          name: ctx.user.name,
          email: ctx.user.email,
          image: ctx.user.image,
        },
        workspaces: workspaces.map((w) => ({
          publicId: w.publicId,
          name: w.name,
          slug: w.slug,
          role: w.role,
        })),
      };
    }),

  update: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(120) }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db.updateWhere(
        "user",
        { id: ctx.user.id },
        { name: input.name, updatedAt: new Date() },
      );
      return {
        id: updated?.id as string | undefined,
        name: updated?.name as string | undefined,
      };
    }),
});
