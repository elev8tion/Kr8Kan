import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { WORKERS } from "@kr8kan/agents";
import { customWorkerRepo, workflowRepo, workspaceRepo } from "@kr8kan/db";
import {
  isValidCron,
  workflowStepsSchema,
  workflowTriggerSchema,
} from "@kr8kan/shared";

import { audit } from "../audit";
import { ensureAgentInfra } from "../agentStore";
import { assertPermission, notFound } from "../permissions";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { ensureScheduler } from "../workflowEngine";

/**
 * workflow.* — Buzz-inspired automations. Authoring needs workspace:edit:
 * workflows run workers and mutate boards, so authorship is an elevated
 * capability. Runs are attributed/capped against the workflow's creator.
 */

async function requireWorkspace(
  ctx: { db: Parameters<typeof workspaceRepo.getWorkspaceByPublicId>[0]; user: { id: string } },
  workspacePublicId: string,
) {
  const workspace = await workspaceRepo.getWorkspaceByPublicId(
    ctx.db,
    workspacePublicId,
  );
  if (!workspace) notFound("workspace");
  await assertPermission(ctx.db, ctx.user.id, workspace.id, "workspace:edit");
  return workspace;
}

async function validateDefinition(
  ctx: { db: Parameters<typeof customWorkerRepo.listCustomWorkers>[0] },
  workspaceId: number,
  trigger: unknown,
  steps: unknown,
  boardPublicId?: string | null,
) {
  const parsedTrigger = workflowTriggerSchema.safeParse(trigger);
  if (!parsedTrigger.success) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `invalid trigger: ${parsedTrigger.error.issues[0]?.message}`,
    });
  }
  if (
    parsedTrigger.data.type === "schedule" &&
    !isValidCron(parsedTrigger.data.cron)
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "invalid cron expression (5 fields: minute hour day month weekday)",
    });
  }
  // Card-less triggers dispatch with only the workflow's board for context —
  // without one, runWorker steps have nothing to work on.
  if (
    (parsedTrigger.data.type === "schedule" ||
      parsedTrigger.data.type === "card.due") &&
    !boardPublicId
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `${parsedTrigger.data.type} workflows need a board — pick one in the builder`,
    });
  }
  const parsedSteps = workflowStepsSchema.safeParse(steps);
  if (!parsedSteps.success) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `invalid steps: ${parsedSteps.error.issues[0]?.message}`,
    });
  }
  // runWorker steps must reference a real worker (stock or workspace custom).
  const stockNames = new Set(WORKERS.map((w) => w.name));
  const customs = await customWorkerRepo.listCustomWorkers(ctx.db, workspaceId);
  const customNames = new Set(customs.map((c) => c.name));
  // dev-task is allowed in workflows since sandbox isolation landed:
  // workflow-triggered tools runs are sandbox-mandatory (enforced at
  // dispatch — non-git folders are rejected) and their output is a
  // 👍-gated patch proposal, never a live edit.
  for (const step of parsedSteps.data) {
    if (
      step.type === "runWorker" &&
      !stockNames.has(step.worker) &&
      !customNames.has(step.worker)
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `unknown worker in step: ${step.worker}`,
      });
    }
  }
  return { trigger: parsedTrigger.data, steps: parsedSteps.data };
}

export const workflowRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ workspacePublicId: z.string().length(12) }))
    .query(async ({ ctx, input }) => {
      ensureAgentInfra(ctx.db);
      ensureScheduler(ctx.db);
      const workspace = await requireWorkspace(ctx, input.workspacePublicId);
      return workflowRepo.listWorkflows(ctx.db, workspace.id);
    }),

  create: protectedProcedure
    .input(
      z.object({
        workspacePublicId: z.string().length(12),
        boardPublicId: z.string().length(12).nullish(),
        name: z.string().min(1).max(160),
        trigger: z.unknown(),
        steps: z.unknown(),
        enabled: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const workspace = await requireWorkspace(ctx, input.workspacePublicId);
      const validated = await validateDefinition(
        ctx,
        workspace.id,
        input.trigger,
        input.steps,
        input.boardPublicId,
      );
      const workflow = await workflowRepo.createWorkflow(ctx.db, {
        workspaceId: workspace.id,
        boardPublicId: input.boardPublicId ?? null,
        name: input.name,
        trigger: validated.trigger,
        steps: validated.steps,
        enabled: input.enabled ?? true,
        createdBy: ctx.user.id,
      });
      audit(ctx.db, {
        workspaceId: workspace.id,
        eventType: "workflow.created",
        entityType: "workflow",
        entityPublicId: workflow?.publicId,
        actorUserId: ctx.user.id,
        payload: { name: input.name, trigger: validated.trigger.type },
      });
      return workflow;
    }),

  update: protectedProcedure
    .input(
      z.object({
        workflowPublicId: z.string().length(12),
        name: z.string().min(1).max(160).optional(),
        enabled: z.boolean().optional(),
        trigger: z.unknown().optional(),
        steps: z.unknown().optional(),
        boardPublicId: z.string().length(12).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const workflow = await workflowRepo.getWorkflowByPublicId(
        ctx.db,
        input.workflowPublicId,
      );
      if (!workflow) notFound("workflow");
      await assertPermission(
        ctx.db,
        ctx.user.id,
        workflow.workspaceId,
        "workspace:edit",
      );
      let trigger = workflow.trigger;
      let steps = workflow.steps;
      const nextBoard =
        input.boardPublicId === undefined
          ? workflow.boardPublicId
          : input.boardPublicId;
      if (input.trigger !== undefined || input.steps !== undefined) {
        const validated = await validateDefinition(
          ctx,
          workflow.workspaceId,
          input.trigger ?? workflow.trigger,
          input.steps ?? workflow.steps,
          nextBoard,
        );
        trigger = validated.trigger;
        steps = validated.steps;
      }
      const updated = await workflowRepo.updateWorkflow(ctx.db, workflow.id, {
        name: input.name,
        enabled: input.enabled,
        trigger,
        steps,
        boardPublicId:
          input.boardPublicId === undefined ? undefined : input.boardPublicId,
      });
      audit(ctx.db, {
        workspaceId: workflow.workspaceId,
        eventType: "workflow.updated",
        entityType: "workflow",
        entityPublicId: workflow.publicId,
        actorUserId: ctx.user.id,
      });
      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ workflowPublicId: z.string().length(12) }))
    .mutation(async ({ ctx, input }) => {
      const workflow = await workflowRepo.getWorkflowByPublicId(
        ctx.db,
        input.workflowPublicId,
      );
      if (!workflow) notFound("workflow");
      await assertPermission(
        ctx.db,
        ctx.user.id,
        workflow.workspaceId,
        "workspace:edit",
      );
      await workflowRepo.updateWorkflow(ctx.db, workflow.id, {
        deletedAt: new Date(),
        enabled: false,
      });
      audit(ctx.db, {
        workspaceId: workflow.workspaceId,
        eventType: "workflow.deleted",
        entityType: "workflow",
        entityPublicId: workflow.publicId,
        actorUserId: ctx.user.id,
      });
      return { success: true };
    }),

  trigger: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/workflows/{slug}/trigger",
        tags: ["workflow"],
      },
    })
    .input(
      z.object({
        workspacePublicId: z.string().length(12),
        slug: z
          .string()
          .min(3)
          .max(64)
          .regex(/^[a-z0-9-]+$/),
      }),
    )
    .output(z.any())
    .mutation(async ({ ctx, input }) => {
      ensureAgentInfra(ctx.db);
      const workspace = await workspaceRepo.getWorkspaceByPublicId(
        ctx.db,
        input.workspacePublicId,
      );
      if (!workspace) notFound("workspace");
      await assertPermission(ctx.db, ctx.user.id, workspace.id, "agent:run");
      const { fireWebhookTrigger } = await import("../workflowEngine");
      const run = await fireWebhookTrigger(ctx.db, workspace.id, input.slug);
      if (!run) notFound("workflow with that webhook slug");
      return { runId: run.publicId, status: run.status };
    }),

  /** Reject a live gate with an optional reason — feeds the
   * rejection-learning loop. Approver rules are enforced inside
   * rejectGateWithReason (same as the ❌ reaction path). */
  rejectGate: protectedProcedure
    .input(
      z.object({
        commentPublicId: z.string().length(12),
        reason: z.string().max(1000).default(""),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      ensureAgentInfra(ctx.db);
      const { rejectGateWithReason } = await import("../workflowEngine");
      const handled = await rejectGateWithReason(
        ctx.db,
        ctx.user,
        input.commentPublicId,
        input.reason,
      );
      if (!handled) notFound("live gate for that comment");
      return { handled };
    }),

  runs: protectedProcedure
    .input(
      z.object({
        workspacePublicId: z.string().length(12),
        workflowPublicId: z.string().length(12).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const workspace = await requireWorkspace(ctx, input.workspacePublicId);
      let workflowId: number | undefined;
      if (input.workflowPublicId) {
        const workflow = await workflowRepo.getWorkflowByPublicId(
          ctx.db,
          input.workflowPublicId,
        );
        if (!workflow || workflow.workspaceId !== workspace.id) {
          notFound("workflow");
        }
        workflowId = workflow.id;
      }
      return workflowRepo.listRuns(ctx.db, workspace.id, {
        workflowId,
        limit: input.limit,
      });
    }),
});
