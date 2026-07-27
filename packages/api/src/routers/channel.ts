import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { MessageRow } from "@kr8kan/db";
import { boardRepo, channelRepo, workspaceRepo } from "@kr8kan/db";
import { slugify } from "@kr8kan/shared";

import { audit } from "../audit";
import { publishLive } from "../liveEvents";
import { handleMessageMentions } from "../mentions";
import { assertPermission, notFound } from "../permissions";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { fireTrigger, handleGateReaction, tryApplyProposal } from "../workflowEngine";
import { requireWorkspaceByPublicId } from "./workspace";

/**
 * channel.* — the Buzz-style conversation surface. Channels are
 * workspace-visible; permissions mirror comments (edit own only, delete
 * own-or-admin, agent-authored messages immutable even to admins).
 * Every mutation lands on the audit chain. Channels are deliberately
 * absent from the public-board payload.
 */

const MESSAGE_PAGE_SIZE = 50;

/** Same emoji protocol as card comments (see card.ts). */
const REACTION_EMOJI = ["👍", "👎", "🎉", "👀", "🚀", "❌"] as const;

/** Threads are one level deep, Slack-style: replying to a reply attaches
 * to the root. Returns the id to store as parentMessageId. */
export function resolveThreadRootId(parent: {
  id: number;
  parentMessageId: number | null;
}): number {
  return parent.parentMessageId ?? parent.id;
}

/** Edit is owner-only; agent messages have no editable text — rewriting
 * an agent's words would corrupt the audit story. */
export function canEditMessage(
  message: { createdBy: string | null; agentIdentityId: number | null },
  userId: string,
): boolean {
  return message.createdBy === userId && !message.agentIdentityId;
}

/** Owner may delete their own; admins may delete any (including noisy
 * agent messages — the operator stays in charge of the surface). */
export function canDeleteMessage(
  message: { createdBy: string | null },
  userId: string,
  role: string | undefined,
): boolean {
  return message.createdBy === userId || role === "admin";
}

async function requireChannel(
  ctx: { db: Parameters<typeof channelRepo.getChannelByPublicId>[0]; user: { id: string } },
  channelPublicId: string,
  permission: Parameters<typeof assertPermission>[3],
) {
  const channel = await channelRepo.getChannelByPublicId(ctx.db, channelPublicId);
  if (!channel) notFound("channel");
  try {
    await assertPermission(ctx.db, ctx.user.id, channel.workspaceId, permission);
  } catch {
    notFound("channel");
  }
  return channel;
}

async function requireMessage(
  ctx: { db: Parameters<typeof channelRepo.getMessageByPublicId>[0]; user: { id: string } },
  messagePublicId: string,
  permission: Parameters<typeof assertPermission>[3],
) {
  const message = await channelRepo.getMessageByPublicId(ctx.db, messagePublicId);
  if (!message) notFound("message");
  try {
    await assertPermission(
      ctx.db,
      ctx.user.id,
      message.channel.workspaceId,
      permission,
    );
  } catch {
    notFound("message");
  }
  return message;
}

function serializeMessage(
  m: MessageRow & {
    author?: { id: string; name: string | null; image: string | null } | null;
    agent?: {
      publicId: string;
      displayName: string;
      avatar: string;
    } | null;
    reactions?: { emoji: string; userId: string }[];
  },
  replyCount?: number,
) {
  return {
    publicId: m.publicId,
    body: m.body,
    author: m.author ?? null,
    agent: m.agent ?? null,
    reactions: m.reactions ?? [],
    editedAt: m.editedAt,
    createdAt: m.createdAt,
    ...(replyCount === undefined ? {} : { replyCount }),
  };
}

export const channelRouter = createTRPCRouter({
  list: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/workspaces/{workspacePublicId}/channels",
        tags: ["channel"],
      },
    })
    .input(z.object({ workspacePublicId: z.string().length(12) }))
    .output(z.any())
    .query(async ({ ctx, input }) => {
      const workspace = await requireWorkspaceByPublicId(
        ctx.db,
        input.workspacePublicId,
      );
      await assertPermission(ctx.db, ctx.user.id, workspace.id, "channel:view");
      const rows = await channelRepo.listChannels(ctx.db, workspace.id);
      return rows.map((c) => ({
        publicId: c.publicId,
        name: c.name,
        slug: c.slug,
        topic: c.topic,
        board: c.board ? { publicId: c.board.publicId, name: c.board.name } : null,
        archivedAt: c.archivedAt,
        createdAt: c.createdAt,
        lastMessageAt: c.lastMessageAt,
      }));
    }),

  create: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/workspaces/{workspacePublicId}/channels",
        tags: ["channel"],
      },
    })
    .input(
      z.object({
        workspacePublicId: z.string().length(12),
        name: z.string().min(1).max(80),
        topic: z.string().max(250).optional(),
        boardPublicId: z.string().length(12).optional(),
      }),
    )
    .output(z.any())
    .mutation(async ({ ctx, input }) => {
      const workspace = await requireWorkspaceByPublicId(
        ctx.db,
        input.workspacePublicId,
      );
      await assertPermission(ctx.db, ctx.user.id, workspace.id, "channel:manage");
      const slug = slugify(input.name) || "channel";
      const existing = await channelRepo.listChannels(ctx.db, workspace.id);
      if (existing.some((c) => c.slug === slug)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `a channel named "${input.name}" already exists`,
        });
      }
      let boardId: number | undefined;
      if (input.boardPublicId) {
        const board = await boardRepo.getBoardByPublicId(
          ctx.db,
          input.boardPublicId,
        );
        if (!board || board.workspaceId !== workspace.id) notFound("board");
        boardId = board.id;
      }
      const channel = await channelRepo.createChannel(ctx.db, {
        workspaceId: workspace.id,
        name: input.name,
        slug,
        topic: input.topic,
        boardId,
        userId: ctx.user.id,
      });
      audit(ctx.db, {
        workspaceId: workspace.id,
        eventType: "channel.created",
        entityType: "channel",
        entityPublicId: channel?.publicId,
        actorUserId: ctx.user.id,
        payload: { name: input.name, board: input.boardPublicId ?? null },
      });
      return channel;
    }),

  byPublicId: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/channels/{channelPublicId}",
        tags: ["channel"],
      },
    })
    .input(z.object({ channelPublicId: z.string().length(12) }))
    .output(z.any())
    .query(async ({ ctx, input }) => {
      const channel = await requireChannel(
        ctx,
        input.channelPublicId,
        "channel:view",
      );
      return {
        publicId: channel.publicId,
        name: channel.name,
        slug: channel.slug,
        topic: channel.topic,
        board: channel.board
          ? { publicId: channel.board.publicId, name: channel.board.name }
          : null,
        archivedAt: channel.archivedAt,
      };
    }),

  update: protectedProcedure
    .meta({
      openapi: {
        method: "PATCH",
        path: "/channels/{channelPublicId}",
        tags: ["channel"],
      },
    })
    .input(
      z.object({
        channelPublicId: z.string().length(12),
        name: z.string().min(1).max(80).optional(),
        topic: z.string().max(250).nullish(),
      }),
    )
    .output(z.any())
    .mutation(async ({ ctx, input }) => {
      const channel = await requireChannel(
        ctx,
        input.channelPublicId,
        "channel:manage",
      );
      const patch: { name?: string; slug?: string; topic?: string | null } = {};
      if (input.name && input.name !== channel.name) {
        const slug = slugify(input.name) || "channel";
        const existing = await channelRepo.listChannels(
          ctx.db,
          channel.workspaceId,
        );
        if (existing.some((c) => c.id !== channel.id && c.slug === slug)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `a channel named "${input.name}" already exists`,
          });
        }
        patch.name = input.name;
        patch.slug = slug;
      }
      if (input.topic !== undefined) patch.topic = input.topic;
      const updated = await channelRepo.updateChannel(ctx.db, channel.id, patch);
      if (patch.name) {
        audit(ctx.db, {
          workspaceId: channel.workspaceId,
          eventType: "channel.renamed",
          entityType: "channel",
          entityPublicId: channel.publicId,
          actorUserId: ctx.user.id,
          payload: { from: channel.name, to: patch.name },
        });
      }
      if (input.topic !== undefined) {
        audit(ctx.db, {
          workspaceId: channel.workspaceId,
          eventType: "channel.topic_updated",
          entityType: "channel",
          entityPublicId: channel.publicId,
          actorUserId: ctx.user.id,
        });
      }
      return updated;
    }),

  setArchived: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/channels/{channelPublicId}/archive",
        tags: ["channel"],
      },
    })
    .input(
      z.object({
        channelPublicId: z.string().length(12),
        archived: z.boolean(),
      }),
    )
    .output(z.any())
    .mutation(async ({ ctx, input }) => {
      const channel = await requireChannel(
        ctx,
        input.channelPublicId,
        "channel:manage",
      );
      const updated = await channelRepo.setChannelArchived(
        ctx.db,
        channel.id,
        input.archived,
      );
      audit(ctx.db, {
        workspaceId: channel.workspaceId,
        eventType: input.archived ? "channel.archived" : "channel.unarchived",
        entityType: "channel",
        entityPublicId: channel.publicId,
        actorUserId: ctx.user.id,
      });
      return updated;
    }),

  delete: protectedProcedure
    .meta({
      openapi: {
        method: "DELETE",
        path: "/channels/{channelPublicId}",
        tags: ["channel"],
      },
    })
    .input(z.object({ channelPublicId: z.string().length(12) }))
    .output(z.any())
    .mutation(async ({ ctx, input }) => {
      const channel = await requireChannel(
        ctx,
        input.channelPublicId,
        "channel:manage",
      );
      await channelRepo.softDeleteChannel(ctx.db, channel.id);
      audit(ctx.db, {
        workspaceId: channel.workspaceId,
        eventType: "channel.deleted",
        entityType: "channel",
        entityPublicId: channel.publicId,
        actorUserId: ctx.user.id,
        payload: { name: channel.name },
      });
      return { success: true };
    }),

  /* messages */

  messages: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/channels/{channelPublicId}/messages",
        tags: ["channel"],
      },
    })
    .input(
      z.object({
        channelPublicId: z.string().length(12),
        cursor: z.number().int().positive().optional(),
      }),
    )
    .output(z.any())
    .query(async ({ ctx, input }) => {
      const channel = await requireChannel(
        ctx,
        input.channelPublicId,
        "channel:view",
      );
      const page = await channelRepo.listRootMessages(ctx.db, channel.id, {
        limit: MESSAGE_PAGE_SIZE + 1,
        cursor: input.cursor,
      });
      const hasMore = page.length > MESSAGE_PAGE_SIZE;
      const rows = hasMore ? page.slice(0, MESSAGE_PAGE_SIZE) : page;
      const nextCursor = hasMore ? rows[rows.length - 1]?.id : undefined;
      // Newest-first from the repo; reversed so display reads oldest → newest.
      return {
        messages: rows
          .map((m) =>
            serializeMessage(
              m,
              m.replies.filter((r) => !r.deletedAt).length,
            ),
          )
          .reverse(),
        nextCursor,
      };
    }),

  thread: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/messages/{messagePublicId}/thread",
        tags: ["channel"],
      },
    })
    .input(z.object({ messagePublicId: z.string().length(12) }))
    .output(z.any())
    .query(async ({ ctx, input }) => {
      const root = await requireMessage(
        ctx,
        input.messagePublicId,
        "channel:view",
      );
      const replies = await channelRepo.getThread(ctx.db, root.id);
      return { replies: replies.map((m) => serializeMessage(m)) };
    }),

  postMessage: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/channels/{channelPublicId}/messages",
        tags: ["channel"],
      },
    })
    .input(
      z.object({
        channelPublicId: z.string().length(12),
        body: z.string().min(1).max(10_000),
        /** Reply target — any message in the thread; attaches to its root. */
        parentMessagePublicId: z.string().length(12).optional(),
      }),
    )
    .output(z.any())
    .mutation(async ({ ctx, input }) => {
      const channel = await requireChannel(
        ctx,
        input.channelPublicId,
        "channel:post",
      );
      if (channel.archivedAt) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "this channel is archived",
        });
      }
      let parentMessageId: number | undefined;
      if (input.parentMessagePublicId) {
        const parent = await channelRepo.getMessageByPublicId(
          ctx.db,
          input.parentMessagePublicId,
        );
        if (!parent || parent.channelId !== channel.id) notFound("message");
        parentMessageId = resolveThreadRootId(parent);
      }
      const message = await channelRepo.addMessage(ctx.db, {
        channelId: channel.id,
        body: input.body,
        userId: ctx.user.id,
        parentMessageId,
      });
      audit(ctx.db, {
        workspaceId: channel.workspaceId,
        eventType: "message.posted",
        entityType: "message",
        entityPublicId: message?.publicId,
        actorUserId: ctx.user.id,
        payload: {
          channel: channel.publicId,
          thread: input.parentMessagePublicId ?? null,
        },
      });
      publishLive(channel.workspaceId, {
        type: "message.posted",
        channelPublicId: channel.publicId,
        messagePublicId: message?.publicId,
      });
      // @worker mentions dispatch through the same path as card comments;
      // the agent's reply lands in this message's thread.
      const mentions = message
        ? await handleMessageMentions(ctx.db, ctx.user, {
            workspaceId: channel.workspaceId,
            channelPublicId: channel.publicId,
            boardPublicId: channel.board?.publicId,
            messageBody: input.body,
            messagePublicId: message.publicId,
          })
        : { dispatched: [], skipped: [] };
      // Human posts only reach this mutation, so messageIsAgent is always
      // false here — agent replies post via the repo and never fire this.
      fireTrigger(ctx.db, {
        type: "message.posted",
        workspaceId: channel.workspaceId,
        boardPublicId: channel.board?.publicId,
        channelPublicId: channel.publicId,
        messagePublicId: message?.publicId,
        messageBody: input.body,
        messageIsAgent: false,
        actorUserId: ctx.user.id,
      });
      return { ...message, mentions };
    }),

  /* reactions — same emoji protocol as card comments; a 👍 on an agent
   * proposal message approves it, a reaction on a gate message resolves
   * the gate. */

  addReaction: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/messages/{messagePublicId}/reactions",
        tags: ["channel"],
      },
    })
    .input(
      z.object({
        messagePublicId: z.string().length(12),
        emoji: z.enum(REACTION_EMOJI),
      }),
    )
    .output(z.any())
    .mutation(async ({ ctx, input }) => {
      const message = await requireMessage(
        ctx,
        input.messagePublicId,
        "channel:post",
      );
      const workspaceId = message.channel.workspaceId;
      const reaction = await channelRepo.addMessageReaction(ctx.db, {
        messageId: message.id,
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
        eventType: "message.reaction.added",
        entityType: "message",
        entityPublicId: message.publicId,
        actorUserId: ctx.user.id,
        payload: { emoji: input.emoji },
      });
      publishLive(workspaceId, {
        type: "message.reaction",
        channelPublicId: message.channel.publicId,
        messagePublicId: message.publicId,
      });
      // Same protocol as comment reactions: a live gate resolves first;
      // otherwise a 👍 on an agent proposal applies it. Both re-check
      // permissions now.
      const gateHandled = await handleGateReaction(
        ctx.db,
        ctx.user,
        { messagePublicId: message.publicId },
        input.emoji,
      );
      const channel = await channelRepo.getChannelByPublicId(
        ctx.db,
        message.channel.publicId,
      );
      const proposalApplied = gateHandled
        ? false
        : await tryApplyProposal(
            ctx.db,
            ctx.user,
            {
              publicId: message.publicId,
              body: message.body,
              agentIdentityId: message.agentIdentityId,
            },
            input.emoji,
            workspaceId,
            { boardPublicId: channel?.board?.publicId },
          );
      // Message reactions fire the same trigger class as comment
      // reactions. No loop risk: no workflow step reacts — reactions are
      // always human mutations. onAgentComment maps to "the reacted-to
      // message was agent-authored".
      fireTrigger(ctx.db, {
        type: "reaction.added",
        workspaceId,
        boardPublicId: channel?.board?.publicId,
        channelPublicId: message.channel.publicId,
        messagePublicId: message.publicId,
        emoji: input.emoji,
        commentIsAgent: Boolean(message.agentIdentityId),
        actorUserId: ctx.user.id,
      });
      return { success: true, gateHandled, proposalApplied };
    }),

  removeReaction: protectedProcedure
    .meta({
      openapi: {
        method: "DELETE",
        path: "/messages/{messagePublicId}/reactions",
        tags: ["channel"],
      },
    })
    .input(
      z.object({
        messagePublicId: z.string().length(12),
        emoji: z.enum(REACTION_EMOJI),
      }),
    )
    .output(z.any())
    .mutation(async ({ ctx, input }) => {
      const message = await requireMessage(
        ctx,
        input.messagePublicId,
        "channel:post",
      );
      await channelRepo.removeMessageReaction(ctx.db, {
        messageId: message.id,
        emoji: input.emoji,
        userId: ctx.user.id,
      });
      publishLive(message.channel.workspaceId, {
        type: "message.reaction",
        channelPublicId: message.channel.publicId,
        messagePublicId: message.publicId,
      });
      return { success: true };
    }),

  updateMessage: protectedProcedure
    .meta({
      openapi: {
        method: "PATCH",
        path: "/messages/{messagePublicId}",
        tags: ["channel"],
      },
    })
    .input(
      z.object({
        messagePublicId: z.string().length(12),
        body: z.string().min(1).max(10_000),
      }),
    )
    .output(z.any())
    .mutation(async ({ ctx, input }) => {
      const message = await requireMessage(
        ctx,
        input.messagePublicId,
        "channel:post",
      );
      if (!canEditMessage(message, ctx.user.id)) notFound("message");
      const updated = await channelRepo.updateMessage(
        ctx.db,
        message.id,
        input.body,
      );
      audit(ctx.db, {
        workspaceId: message.channel.workspaceId,
        eventType: "message.edited",
        entityType: "message",
        entityPublicId: message.publicId,
        actorUserId: ctx.user.id,
      });
      publishLive(message.channel.workspaceId, {
        type: "message.edited",
        channelPublicId: message.channel.publicId,
        messagePublicId: message.publicId,
      });
      return updated;
    }),

  deleteMessage: protectedProcedure
    .meta({
      openapi: {
        method: "DELETE",
        path: "/messages/{messagePublicId}",
        tags: ["channel"],
      },
    })
    .input(z.object({ messagePublicId: z.string().length(12) }))
    .output(z.any())
    .mutation(async ({ ctx, input }) => {
      const message = await requireMessage(
        ctx,
        input.messagePublicId,
        "channel:post",
      );
      const membership = await workspaceRepo.getMembership(
        ctx.db,
        ctx.user.id,
        message.channel.workspaceId,
      );
      if (!canDeleteMessage(message, ctx.user.id, membership?.role)) {
        notFound("message");
      }
      await channelRepo.softDeleteMessage(ctx.db, message.id);
      audit(ctx.db, {
        workspaceId: message.channel.workspaceId,
        eventType: "message.deleted",
        entityType: "message",
        entityPublicId: message.publicId,
        actorUserId: ctx.user.id,
        payload: { wasAgent: Boolean(message.agentIdentityId) },
      });
      publishLive(message.channel.workspaceId, {
        type: "message.deleted",
        channelPublicId: message.channel.publicId,
        messagePublicId: message.publicId,
      });
      return { success: true };
    }),
});
