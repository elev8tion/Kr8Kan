import { z } from "zod";

import {
  agentJobRepo,
  cardRepo,
  channelRepo,
  workflowRepo,
  workspaceRepo,
} from "@kr8kan/db";
import { roleHasPermission, workflowStepsSchema } from "@kr8kan/shared";

import { assertPermission, notFound } from "../permissions";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * my.* — the caller's attention surface: assigned cards, due-soon work,
 * approvable gates, and a notification feed. Everything is derived from
 * existing rows — no new tables, no read-state persistence (the client
 * keeps a local watermark).
 */

const DUE_SOON_DAYS = 7;

async function requireMember(
  ctx: { db: Parameters<typeof workspaceRepo.getWorkspaceByPublicId>[0]; user: { id: string } },
  workspacePublicId: string,
) {
  const workspace = await workspaceRepo.getWorkspaceByPublicId(
    ctx.db,
    workspacePublicId,
  );
  if (!workspace) notFound("workspace");
  const membership = await assertPermission(
    ctx.db,
    ctx.user.id,
    workspace.id,
    "workspace:view",
  );
  return { workspace, membership };
}

async function approvableGates(
  db: Parameters<typeof workflowRepo.listPendingGates>[0],
  workspaceId: number,
  role: "admin" | "member" | "guest",
) {
  if (!roleHasPermission(role, "agent:run")) return [];
  const gates = await workflowRepo.listPendingGates(db, workspaceId);
  return gates
    .filter((run) => {
      const steps = workflowStepsSchema.safeParse(run.workflow.steps);
      const gateStep = steps.success ? steps.data[run.currentStep] : undefined;
      if (gateStep?.type !== "gate") return false;
      return gateStep.approvers !== "admin" || role === "admin";
    })
    .map((run) => ({
      runPublicId: run.publicId,
      workflowName: run.workflow.name,
      cardPublicId: run.cardPublicId,
      boardPublicId: run.workflow.boardPublicId,
      gateCommentPublicId: run.gateCommentPublicId,
      gateExpiresAt: run.gateExpiresAt,
    }));
}

export const myRouter = createTRPCRouter({
  overview: protectedProcedure
    .input(z.object({ workspacePublicId: z.string().length(12) }))
    .query(async ({ ctx, input }) => {
      const { workspace, membership } = await requireMember(
        ctx,
        input.workspacePublicId,
      );

      const mine = await cardRepo.listMyCards(ctx.db, {
        workspaceId: workspace.id,
        userId: ctx.user.id,
      });

      const dueCutoff = new Date(Date.now() + DUE_SOON_DAYS * 24 * 3600_000);
      const assignedCards = mine
        .filter((c) => c.assignedToMe)
        .sort((a, b) => {
          if (a.dueDate && b.dueDate) return a.dueDate.getTime() - b.dueDate.getTime();
          if (a.dueDate) return -1;
          if (b.dueDate) return 1;
          return b.createdAt.getTime() - a.createdAt.getTime();
        })
        .slice(0, 50);
      const dueSoon = mine
        .filter((c) => c.dueDate && c.dueDate <= dueCutoff)
        .sort((a, b) => a.dueDate!.getTime() - b.dueDate!.getTime())
        .slice(0, 50);

      const [pendingGates, channelActivity] = await Promise.all([
        approvableGates(ctx.db, workspace.id, membership.role),
        channelRepo.listChannelActivityForUser(ctx.db, {
          workspaceId: workspace.id,
          userId: ctx.user.id,
          userName: ctx.user.name ?? null,
          userEmail: ctx.user.email ?? null,
        }),
      ]);

      return { assignedCards, dueSoon, pendingGates, channelActivity };
    }),

  notifications: protectedProcedure
    .input(
      z.object({
        workspacePublicId: z.string().length(12),
        after: z.string().datetime().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { workspace, membership } = await requireMember(
        ctx,
        input.workspacePublicId,
      );

      const [jobs, agentComments, gates, channelActivity] = await Promise.all([
        agentJobRepo.listRecentFinishedJobsForUser(
          ctx.db,
          workspace.id,
          ctx.user.id,
        ),
        cardRepo.listAgentActivityForUser(ctx.db, {
          workspaceId: workspace.id,
          userId: ctx.user.id,
        }),
        approvableGates(ctx.db, workspace.id, membership.role),
        channelRepo.listChannelActivityForUser(ctx.db, {
          workspaceId: workspace.id,
          userId: ctx.user.id,
          userName: ctx.user.name ?? null,
          userEmail: ctx.user.email ?? null,
        }),
      ]);

      const items: {
        kind: "job" | "agent_comment" | "gate" | "channel";
        title: string;
        cardPublicId?: string | null;
        boardPublicId?: string | null;
        commentPublicId?: string | null;
        channelPublicId?: string | null;
        messagePublicId?: string | null;
        threadRootPublicId?: string | null;
        jobId?: string;
        at: string;
      }[] = [
        ...jobs.map((j) => ({
          kind: "job" as const,
          title: `${j.worker} ${j.status === "completed" ? "finished" : "failed"}`,
          cardPublicId: j.cardPublicId,
          boardPublicId: j.boardPublicId,
          jobId: j.publicId,
          at: (j.completedAt ?? j.createdAt).toISOString(),
        })),
        ...agentComments.map((c) => ({
          kind: "agent_comment" as const,
          title: `${c.agentAvatar} ${c.agentName} commented on “${c.cardTitle}”`,
          cardPublicId: c.cardPublicId,
          boardPublicId: c.boardPublicId,
          at: c.at.toISOString(),
        })),
        ...gates.map((g) => ({
          kind: "gate" as const,
          title: `Approval needed — ${g.workflowName}`,
          cardPublicId: g.cardPublicId,
          boardPublicId: g.boardPublicId,
          commentPublicId: g.gateCommentPublicId,
          at: (g.gateExpiresAt ?? new Date()).toISOString(),
        })),
        ...channelActivity.map((m) => ({
          kind: "channel" as const,
          title: `${m.authorName} in #${m.channelName}: ${m.snippet}`,
          channelPublicId: m.channelPublicId,
          messagePublicId: m.messagePublicId,
          threadRootPublicId: m.threadRootPublicId,
          at: m.at.toISOString(),
        })),
      ]
        .filter((i) => !input.after || i.at > input.after)
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 30);

      return items;
    }),
});
