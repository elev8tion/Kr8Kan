import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { workspaceRepo } from "@kr8kan/db";
import { sendEmail } from "@kr8kan/email";

import { assertPermission, notFound } from "../permissions";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { requireWorkspaceByPublicId } from "./workspace";

const roleSchema = z.enum(["admin", "member", "guest"]);

export const memberRouter = createTRPCRouter({
  list: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/workspaces/{workspacePublicId}/members",
        tags: ["member"],
      },
    })
    .input(z.object({ workspacePublicId: z.string().length(12) }))
    .output(z.any())
    .query(async ({ ctx, input }) => {
      const workspace = await requireWorkspaceByPublicId(
        ctx.db,
        input.workspacePublicId,
      );
      await assertPermission(ctx.db, ctx.user.id, workspace.id, "member:view");
      const members = await workspaceRepo.listMembers(ctx.db, workspace.id);
      return members.map((m) => ({
        publicId: m.publicId,
        role: m.role,
        createdAt: m.createdAt,
        user: {
          id: m.user.id,
          name: m.user.name,
          email: m.user.email,
          image: m.user.image,
        },
      }));
    }),

  invite: protectedProcedure
    .input(
      z.object({
        workspacePublicId: z.string().length(12),
        role: roleSchema.default("member"),
        email: z.string().email().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const workspace = await requireWorkspaceByPublicId(
        ctx.db,
        input.workspacePublicId,
      );
      await assertPermission(ctx.db, ctx.user.id, workspace.id, "member:invite");
      const invite = await workspaceRepo.createInvite(ctx.db, {
        workspaceId: workspace.id,
        role: input.role,
        email: input.email,
        createdBy: ctx.user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      });
      if (!invite) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const inviteUrl = `${process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3310"}/invite/${invite.code}`;
      if (input.email) {
        await sendEmail(input.email, {
          type: "JOIN_WORKSPACE",
          workspaceName: workspace.name,
          inviteUrl,
        });
      }
      return { ...invite, inviteUrl };
    }),

  invites: protectedProcedure
    .input(z.object({ workspacePublicId: z.string().length(12) }))
    .query(async ({ ctx, input }) => {
      const workspace = await requireWorkspaceByPublicId(
        ctx.db,
        input.workspacePublicId,
      );
      await assertPermission(ctx.db, ctx.user.id, workspace.id, "member:invite");
      const invites = await workspaceRepo.listInvites(ctx.db, workspace.id);
      const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3310";
      return invites
        .filter((i) => !i.acceptedAt)
        .map((i) => ({ ...i, inviteUrl: `${base}/invite/${i.code}` }));
    }),

  revokeInvite: protectedProcedure
    .input(
      z.object({
        workspacePublicId: z.string().length(12),
        invitePublicId: z.string().length(12),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const workspace = await requireWorkspaceByPublicId(
        ctx.db,
        input.workspacePublicId,
      );
      await assertPermission(ctx.db, ctx.user.id, workspace.id, "member:manage");
      await workspaceRepo.revokeInvite(ctx.db, input.invitePublicId);
      return { success: true };
    }),

  acceptInvite: protectedProcedure
    .input(z.object({ code: z.string().min(6).max(32) }))
    .mutation(async ({ ctx, input }) => {
      const invite = await workspaceRepo.getInviteByCode(ctx.db, input.code);
      if (!invite || invite.acceptedAt) notFound("invite");
      if (invite.expiresAt && invite.expiresAt < new Date()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "invite expired" });
      }
      await workspaceRepo.acceptInvite(ctx.db, invite.id, ctx.user.id);
      return { workspace: invite.workspace };
    }),

  inviteInfo: protectedProcedure
    .input(z.object({ code: z.string().min(6).max(32) }))
    .query(async ({ ctx, input }) => {
      const invite = await workspaceRepo.getInviteByCode(ctx.db, input.code);
      if (!invite || invite.acceptedAt) notFound("invite");
      return {
        workspaceName: invite.workspace.name,
        role: invite.role,
        expired: Boolean(invite.expiresAt && invite.expiresAt < new Date()),
      };
    }),

  updateRole: protectedProcedure
    .input(
      z.object({
        workspacePublicId: z.string().length(12),
        memberPublicId: z.string().length(12),
        role: roleSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const workspace = await requireWorkspaceByPublicId(
        ctx.db,
        input.workspacePublicId,
      );
      await assertPermission(ctx.db, ctx.user.id, workspace.id, "member:manage");
      return workspaceRepo.updateMemberRole(
        ctx.db,
        input.memberPublicId,
        input.role,
      );
    }),

  remove: protectedProcedure
    .input(
      z.object({
        workspacePublicId: z.string().length(12),
        memberPublicId: z.string().length(12),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const workspace = await requireWorkspaceByPublicId(
        ctx.db,
        input.workspacePublicId,
      );
      await assertPermission(ctx.db, ctx.user.id, workspace.id, "member:manage");
      const target = await workspaceRepo.getMemberByPublicId(
        ctx.db,
        input.memberPublicId,
      );
      if (target?.userId === ctx.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot remove yourself",
        });
      }
      await workspaceRepo.removeMember(ctx.db, input.memberPublicId);
      return { success: true };
    }),
});
