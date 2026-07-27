import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { workspaceRepo } from "@kr8kan/db";
import { sendEmail } from "@kr8kan/email";

import { audit } from "../audit";
import { assertPermission, notFound } from "../permissions";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { requireWorkspaceByPublicId } from "./workspace";

const roleSchema = z.enum(["admin", "member", "guest"]);

/** Target member must exist AND belong to the caller's workspace — a
 * bare publicId lookup would let member:manage in one workspace act on
 * members of another. */
async function requireTargetMember(
  db: Parameters<typeof workspaceRepo.getMemberByPublicId>[0],
  memberPublicId: string,
  workspaceId: number,
) {
  const target = await workspaceRepo.getMemberByPublicId(db, memberPublicId);
  if (!target || target.workspaceId !== workspaceId) notFound("member");
  return target;
}

/** A workspace must never lose its final admin — there is no in-app
 * recovery path once nobody can manage members or settings. */
async function assertNotLastAdmin(
  db: Parameters<typeof workspaceRepo.listMembers>[0],
  workspaceId: number,
  action: "demote" | "remove",
) {
  const members = await workspaceRepo.listMembers(db, workspaceId);
  const admins = members.filter((m) => m.role === "admin");
  if (admins.length <= 1) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Cannot ${action} the last admin — promote another member to admin first`,
    });
  }
}

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
      // Email-targeted invites are only redeemable by that address; open
      // invites (no email) remain shareable links by design.
      if (
        invite.email &&
        invite.email.toLowerCase() !== ctx.user.email.toLowerCase()
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `This invite was issued for ${invite.email}. Sign in with that account to accept it.`,
        });
      }
      await workspaceRepo.acceptInvite(ctx.db, invite.id, ctx.user.id);
      audit(ctx.db, {
        workspaceId: invite.workspaceId,
        eventType: "member.joined",
        entityType: "member",
        actorUserId: ctx.user.id,
        payload: { role: invite.role },
      });
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
      const target = await requireTargetMember(
        ctx.db,
        input.memberPublicId,
        workspace.id,
      );
      if (target.role === "admin" && input.role !== "admin") {
        await assertNotLastAdmin(ctx.db, workspace.id, "demote");
      }
      const updated = await workspaceRepo.updateMemberRole(
        ctx.db,
        input.memberPublicId,
        input.role,
      );
      audit(ctx.db, {
        workspaceId: workspace.id,
        eventType: "member.role.changed",
        entityType: "member",
        entityPublicId: input.memberPublicId,
        actorUserId: ctx.user.id,
        payload: { role: input.role },
      });
      return updated;
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
      const target = await requireTargetMember(
        ctx.db,
        input.memberPublicId,
        workspace.id,
      );
      if (target.userId === ctx.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot remove yourself",
        });
      }
      if (target.role === "admin") {
        await assertNotLastAdmin(ctx.db, workspace.id, "remove");
      }
      await workspaceRepo.removeMember(ctx.db, input.memberPublicId);
      audit(ctx.db, {
        workspaceId: workspace.id,
        eventType: "member.removed",
        entityType: "member",
        entityPublicId: input.memberPublicId,
        actorUserId: ctx.user.id,
      });
      return { success: true };
    }),
});
