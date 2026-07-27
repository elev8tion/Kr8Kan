import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { boardRepo, cardRepo } from "@kr8kan/db";

import { audit } from "../audit";
import { handleCommentMentions } from "../mentions";
import { assertPermission, notFound } from "../permissions";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { dispatchWebhookEvent } from "../webhooks";
import {
  fireTrigger,
  handleGateReaction,
  tryApplyProposal,
} from "../workflowEngine";

const REACTION_EMOJI = ["👍", "👎", "🎉", "👀", "🚀", "❌"] as const;

async function requireCard(
  ctx: { db: Parameters<typeof cardRepo.getCardWithBoard>[0]; user: { id: string } },
  cardPublicId: string,
  permission: Parameters<typeof assertPermission>[3],
) {
  const card = await cardRepo.getCardWithBoard(ctx.db, cardPublicId);
  if (!card) notFound("card");
  await assertPermission(
    ctx.db,
    ctx.user.id,
    card.list.board.workspaceId,
    permission,
  );
  return card;
}

export const cardRouter = createTRPCRouter({
  byPublicId: protectedProcedure
    .meta({
      openapi: { method: "GET", path: "/cards/{cardPublicId}", tags: ["card"] },
    })
    .input(z.object({ cardPublicId: z.string().length(12) }))
    .output(z.any())
    .query(async ({ ctx, input }) => {
      await requireCard(ctx, input.cardPublicId, "card:view");
      return cardRepo.getCardByPublicId(ctx.db, input.cardPublicId);
    }),

  create: protectedProcedure
    .meta({
      openapi: { method: "POST", path: "/cards", tags: ["card"] },
    })
    .input(
      z.object({
        listPublicId: z.string().length(12),
        title: z.string().min(1).max(500),
        description: z.string().max(20_000).optional(),
      }),
    )
    .output(z.any())
    .mutation(async ({ ctx, input }) => {
      const list = await boardRepo.getListByPublicId(ctx.db, input.listPublicId);
      if (!list) notFound("list");
      await assertPermission(
        ctx.db,
        ctx.user.id,
        list.board.workspaceId,
        "card:create",
      );
      const card = await cardRepo.createCard(ctx.db, {
        listId: list.id,
        title: input.title,
        description: input.description,
        userId: ctx.user.id,
      });
      dispatchWebhookEvent(ctx.db, list.board.workspaceId, "card.created", {
        card: { publicId: card.publicId, title: card.title },
        board: { publicId: list.board.publicId, name: list.board.name },
        list: { publicId: list.publicId, name: list.name },
      });
      audit(ctx.db, {
        workspaceId: list.board.workspaceId,
        eventType: "card.created",
        entityType: "card",
        entityPublicId: card.publicId,
        actorUserId: ctx.user.id,
        payload: { title: card.title, list: list.name },
      });
      fireTrigger(ctx.db, {
        type: "card.created",
        workspaceId: list.board.workspaceId,
        boardPublicId: list.board.publicId,
        cardPublicId: card.publicId,
        listPublicId: list.publicId,
        actorUserId: ctx.user.id,
      });
      return card;
    }),

  update: protectedProcedure
    .meta({
      openapi: { method: "PUT", path: "/cards/{cardPublicId}", tags: ["card"] },
    })
    .input(
      z.object({
        cardPublicId: z.string().length(12),
        title: z.string().min(1).max(500).optional(),
        description: z.string().max(20_000).nullish(),
        dueDate: z.coerce.date().nullish(),
      }),
    )
    .output(z.any())
    .mutation(async ({ ctx, input }) => {
      const card = await requireCard(ctx, input.cardPublicId, "card:edit");
      const updated = await cardRepo.updateCard(
        ctx.db,
        card.id,
        {
          title: input.title,
          description: input.description,
          dueDate: input.dueDate,
        },
        ctx.user.id,
      );
      audit(ctx.db, {
        workspaceId: card.list.board.workspaceId,
        eventType: "card.updated",
        entityType: "card",
        entityPublicId: card.publicId,
        actorUserId: ctx.user.id,
        payload: { fields: Object.keys(input).filter((k) => k !== "cardPublicId") },
      });
      return updated;
    }),

  move: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/cards/{cardPublicId}/move",
        tags: ["card"],
      },
    })
    .input(
      z.object({
        cardPublicId: z.string().length(12),
        toListPublicId: z.string().length(12),
        position: z.number().int().min(0).max(10_000),
      }),
    )
    .output(z.any())
    .mutation(async ({ ctx, input }) => {
      const card = await requireCard(ctx, input.cardPublicId, "card:move");
      const toList = await boardRepo.getListByPublicId(
        ctx.db,
        input.toListPublicId,
      );
      if (!toList) notFound("list");
      if (toList.board.workspaceId !== card.list.board.workspaceId) {
        notFound("list");
      }
      // The board UI only ever offers lists from the card's own board (see
      // apps/web BoardView drag-and-drop and CardDetail's move dropdown,
      // both scoped to the current board's lists) — a cross-board move is
      // only REST-reachable and would orphan this board's labels on the
      // card. Reject it outright rather than silently stripping labels.
      if (toList.boardId !== card.list.boardId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "cannot move a card across boards",
        });
      }
      const moved = await cardRepo.moveCard(ctx.db, {
        cardId: card.id,
        toListId: toList.id,
        position: input.position,
        userId: ctx.user.id,
      });
      dispatchWebhookEvent(ctx.db, toList.board.workspaceId, "card.moved", {
        card: { publicId: card.publicId, title: card.title },
        toList: { publicId: toList.publicId, name: toList.name },
      });
      audit(ctx.db, {
        workspaceId: toList.board.workspaceId,
        eventType: "card.moved",
        entityType: "card",
        entityPublicId: card.publicId,
        actorUserId: ctx.user.id,
        payload: { toList: toList.name },
      });
      fireTrigger(ctx.db, {
        type: "card.moved",
        workspaceId: toList.board.workspaceId,
        boardPublicId: toList.board.publicId,
        cardPublicId: card.publicId,
        toListPublicId: toList.publicId,
        actorUserId: ctx.user.id,
      });
      return moved;
    }),

  delete: protectedProcedure
    .meta({
      openapi: {
        method: "DELETE",
        path: "/cards/{cardPublicId}",
        tags: ["card"],
      },
    })
    .input(z.object({ cardPublicId: z.string().length(12) }))
    .output(z.any())
    .mutation(async ({ ctx, input }) => {
      const card = await requireCard(ctx, input.cardPublicId, "card:delete");
      await cardRepo.softDeleteCard(ctx.db, card.id);
      dispatchWebhookEvent(ctx.db, card.list.board.workspaceId, "card.deleted", {
        card: { publicId: card.publicId, title: card.title },
      });
      audit(ctx.db, {
        workspaceId: card.list.board.workspaceId,
        eventType: "card.deleted",
        entityType: "card",
        entityPublicId: card.publicId,
        actorUserId: ctx.user.id,
      });
      return { success: true };
    }),

  /* labels */
  addLabel: protectedProcedure
    .input(
      z.object({
        cardPublicId: z.string().length(12),
        labelPublicId: z.string().length(12),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const card = await requireCard(ctx, input.cardPublicId, "card:edit");
      const label = await boardRepo.getLabelByPublicId(
        ctx.db,
        input.labelPublicId,
      );
      if (!label || label.boardId !== card.list.boardId) notFound("label");
      await cardRepo.addLabelToCard(ctx.db, card.id, label.id, ctx.user.id);
      audit(ctx.db, {
        workspaceId: card.list.board.workspaceId,
        eventType: "card.label.added",
        entityType: "card",
        entityPublicId: card.publicId,
        actorUserId: ctx.user.id,
        payload: { label: label.name },
      });
      fireTrigger(ctx.db, {
        type: "label.added",
        workspaceId: card.list.board.workspaceId,
        boardPublicId: card.list.board.publicId,
        cardPublicId: card.publicId,
        labelPublicId: label.publicId,
        actorUserId: ctx.user.id,
      });
      return { success: true };
    }),

  removeLabel: protectedProcedure
    .input(
      z.object({
        cardPublicId: z.string().length(12),
        labelPublicId: z.string().length(12),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const card = await requireCard(ctx, input.cardPublicId, "card:edit");
      const label = await boardRepo.getLabelByPublicId(
        ctx.db,
        input.labelPublicId,
      );
      if (!label || label.boardId !== card.list.boardId) notFound("label");
      await cardRepo.removeLabelFromCard(ctx.db, card.id, label.id);
      return { success: true };
    }),

  /* members */
  addMember: protectedProcedure
    .input(
      z.object({
        cardPublicId: z.string().length(12),
        memberPublicId: z.string().length(12),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const card = await requireCard(ctx, input.cardPublicId, "card:edit");
      const { workspaceRepo } = await import("@kr8kan/db");
      const member = await workspaceRepo.getMemberByPublicId(
        ctx.db,
        input.memberPublicId,
      );
      if (!member || member.workspaceId !== card.list.board.workspaceId) {
        notFound("member");
      }
      await cardRepo.addMemberToCard(ctx.db, card.id, member.id, ctx.user.id);
      return { success: true };
    }),

  removeMember: protectedProcedure
    .input(
      z.object({
        cardPublicId: z.string().length(12),
        memberPublicId: z.string().length(12),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const card = await requireCard(ctx, input.cardPublicId, "card:edit");
      const { workspaceRepo } = await import("@kr8kan/db");
      const member = await workspaceRepo.getMemberByPublicId(
        ctx.db,
        input.memberPublicId,
      );
      if (!member || member.workspaceId !== card.list.board.workspaceId) {
        notFound("member");
      }
      await cardRepo.removeMemberFromCard(ctx.db, card.id, member.id);
      return { success: true };
    }),

  /* comments */
  addComment: protectedProcedure
    .input(
      z.object({
        cardPublicId: z.string().length(12),
        comment: z.string().min(1).max(10_000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const card = await requireCard(ctx, input.cardPublicId, "card:comment");
      const comment = await cardRepo.addComment(ctx.db, {
        cardId: card.id,
        comment: input.comment,
        userId: ctx.user.id,
      });
      const workspaceId = card.list.board.workspaceId;
      audit(ctx.db, {
        workspaceId,
        eventType: "card.comment.created",
        entityType: "comment",
        entityPublicId: comment?.publicId,
        actorUserId: ctx.user.id,
      });
      // @worker mentions dispatch through the same path as the UI runner.
      const mentions = comment
        ? await handleCommentMentions(ctx.db, ctx.user, {
            workspaceId,
            cardPublicId: card.publicId,
            boardPublicId: card.list.board.publicId,
            commentBody: input.comment,
            commentPublicId: comment.publicId,
          })
        : { dispatched: [], skipped: [] };
      fireTrigger(ctx.db, {
        type: "comment.created",
        workspaceId,
        boardPublicId: card.list.board.publicId,
        cardPublicId: card.publicId,
        commentPublicId: comment?.publicId,
        commentBody: input.comment,
        actorUserId: ctx.user.id,
      });
      return { ...comment, mentions };
    }),

  addReaction: protectedProcedure
    .input(
      z.object({
        commentPublicId: z.string().length(12),
        emoji: z.enum(REACTION_EMOJI),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const comment = await cardRepo.getCommentByPublicId(
        ctx.db,
        input.commentPublicId,
      );
      if (!comment) notFound("comment");
      const workspaceId = comment.card.list.board.workspaceId;
      await assertPermission(ctx.db, ctx.user.id, workspaceId, "card:comment");
      const reaction = await cardRepo.addReaction(ctx.db, {
        commentId: comment.id,
        emoji: input.emoji,
        userId: ctx.user.id,
      });
      if (!reaction) {
        // Reaction already existed (insertIfAbsent no-op) — replaying the
        // same emoji must not replay audit rows, gate resolution, proposal
        // application, or workflow triggers.
        return { success: true, gateHandled: false, proposalApplied: false };
      }
      audit(ctx.db, {
        workspaceId,
        eventType: "comment.reaction.added",
        entityType: "comment",
        entityPublicId: comment.publicId,
        actorUserId: ctx.user.id,
        payload: { emoji: input.emoji },
      });
      // A reaction on a live gate comment resolves the gate; a 👍 on an
      // agent proposal comment applies it. Both re-check permissions now.
      const gateHandled = await handleGateReaction(
        ctx.db,
        ctx.user,
        comment.publicId,
        input.emoji,
      );
      // gateHandled short-circuits the apply attempt entirely, so no
      // reason applies there — proposalReason is only ever set when an
      // apply was genuinely attempted (i.e. tryApplyProposal ran).
      const applyResult = gateHandled
        ? { applied: false as const }
        : await tryApplyProposal(
            ctx.db,
            ctx.user,
            {
              publicId: comment.publicId,
              body: comment.comment,
              agentIdentityId: comment.agentIdentityId,
            },
            input.emoji,
            workspaceId,
            {
              cardPublicId: comment.card.publicId,
              boardPublicId: comment.card.list.board.publicId,
            },
          );
      fireTrigger(ctx.db, {
        type: "reaction.added",
        workspaceId,
        boardPublicId: comment.card.list.board.publicId,
        cardPublicId: comment.card.publicId,
        commentPublicId: comment.publicId,
        emoji: input.emoji,
        commentIsAgent: Boolean(comment.agentIdentityId),
        actorUserId: ctx.user.id,
      });
      return {
        success: true,
        gateHandled,
        proposalApplied: applyResult.applied,
        proposalReason: applyResult.reason,
      };
    }),

  removeReaction: protectedProcedure
    .input(
      z.object({
        commentPublicId: z.string().length(12),
        emoji: z.enum(REACTION_EMOJI),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const comment = await cardRepo.getCommentByPublicId(
        ctx.db,
        input.commentPublicId,
      );
      if (!comment) notFound("comment");
      await assertPermission(
        ctx.db,
        ctx.user.id,
        comment.card.list.board.workspaceId,
        "card:comment",
      );
      await cardRepo.removeReaction(ctx.db, {
        commentId: comment.id,
        emoji: input.emoji,
        userId: ctx.user.id,
      });
      return { success: true };
    }),

  updateComment: protectedProcedure
    .input(
      z.object({
        commentPublicId: z.string().length(12),
        comment: z.string().min(1).max(10_000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const comment = await cardRepo.getCommentByPublicId(
        ctx.db,
        input.commentPublicId,
      );
      if (!comment || comment.createdBy !== ctx.user.id) notFound("comment");
      // Agent-authored comments are the agent's record — edit is owner-only
      // and agents have no owner-editable text.
      if (comment.agentIdentityId) notFound("comment");
      const updated = await cardRepo.updateComment(ctx.db, comment.id, input.comment);
      audit(ctx.db, {
        workspaceId: comment.card.list.board.workspaceId,
        eventType: "comment.updated",
        entityType: "comment",
        entityPublicId: comment.publicId,
        actorUserId: ctx.user.id,
      });
      return updated;
    }),

  deleteComment: protectedProcedure
    .input(z.object({ commentPublicId: z.string().length(12) }))
    .mutation(async ({ ctx, input }) => {
      const comment = await cardRepo.getCommentByPublicId(
        ctx.db,
        input.commentPublicId,
      );
      if (!comment) notFound("comment");
      const workspaceId = comment.card.list.board.workspaceId;
      // Owner may delete their own; workspace admins may delete any
      // (including noisy agent replies — the operator stays in charge).
      if (comment.createdBy !== ctx.user.id) {
        const { workspaceRepo } = await import("@kr8kan/db");
        const membership = await workspaceRepo.getMembership(
          ctx.db,
          ctx.user.id,
          workspaceId,
        );
        if (membership?.role !== "admin") notFound("comment");
      }
      await cardRepo.softDeleteComment(ctx.db, comment.id);
      audit(ctx.db, {
        workspaceId,
        eventType: "comment.deleted",
        entityType: "comment",
        entityPublicId: comment.publicId,
        actorUserId: ctx.user.id,
        payload: { wasAgent: Boolean(comment.agentIdentityId) },
      });
      return { success: true };
    }),
});
