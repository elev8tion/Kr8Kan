import { execFile } from "node:child_process";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type {
  JobRecord,
  WorkerBoardContext,
  WorkerCardContext,
  WorkerContext,
} from "@kr8kan/agents";
import {
  WORKERS,
  cancelJob,
  checkPiHealth,
  getJob,
  getWorker,
  listJobs,
  projectRoots,
  runWorker,
  scrubEnv,
  toolsAllowed,
  workersEnabled,
} from "@kr8kan/agents";
import { agentJobRepo, boardRepo, cardRepo, workspaceRepo } from "@kr8kan/db";
import { roleHasPermission } from "@kr8kan/shared";

import { applyActionSchema, applyJobActions } from "../agentApply";
import { ensureAgentInfra } from "../agentStore";
import { assertPermission, notFound } from "../permissions";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * agent.* — Pi worker orchestration. Jobs are DB-backed (agent_job) and
 * workspace-scoped; the runner shells out to the operator's local `pi`
 * CLI (~/.pi agent layer). Works with session cookies or API keys.
 */

const workerNameEnum = z.enum(
  WORKERS.map((w) => w.name) as [string, ...string[]],
);

const jobStatusEnum = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

/* ── per-user run limits (on top of the global tRPC rate limit) ──── */

function maxActivePerUser(): number {
  const raw = Number(process.env.KR8KAN_PI_MAX_PER_USER);
  return Number.isFinite(raw) && raw > 0 ? raw : 3;
}

function maxRunsPerHour(): number {
  const raw = Number(process.env.KR8KAN_PI_MAX_PER_HOUR);
  return Number.isFinite(raw) && raw > 0 ? raw : 30;
}

/* ── context builders ─────────────────────────────────────────────── */

async function buildBoardContext(
  db: Parameters<typeof boardRepo.getBoardWithContents>[0],
  boardPublicId: string,
): Promise<{ context: WorkerBoardContext; workspaceId: number }> {
  const board = await boardRepo.getBoardWithContents(db, boardPublicId);
  if (!board) notFound("board");
  return {
    workspaceId: board.workspaceId,
    context: {
      publicId: board.publicId,
      name: board.name,
      labels: board.labels.map((l) => ({ publicId: l.publicId, name: l.name })),
      lists: board.lists.map((list) => ({
        publicId: list.publicId,
        name: list.name,
        cards: list.cards.map((card) => ({
          publicId: card.publicId,
          title: card.title,
          description: card.description?.slice(0, 500),
          dueDate: card.dueDate?.toISOString() ?? null,
          labels: card.labels.map((cl) => cl.label.name),
        })),
      })),
    },
  };
}

async function buildCardContext(
  db: Parameters<typeof cardRepo.getCardByPublicId>[0],
  cardPublicId: string,
  opts?: { fullDescription?: boolean },
): Promise<{
  context: WorkerCardContext;
  workspaceId: number;
  boardPublicId: string;
  agentPath: string | null;
  agentVerifyCommand: string | null;
  cardId: number;
}> {
  const card = await cardRepo.getCardByPublicId(db, cardPublicId);
  if (!card) notFound("card");
  // Sibling cards in the same list give placement context (title + id only).
  const siblings = await cardRepo.listCardsByList(db, card.listId);
  return {
    workspaceId: card.list.board.workspaceId,
    boardPublicId: card.list.board.publicId,
    agentPath: card.list.board.agentPath,
    agentVerifyCommand: card.list.board.agentVerifyCommand,
    cardId: card.id,
    context: {
      publicId: card.publicId,
      title: card.title,
      // dev-task gets the full card; advisory workers get a capped slice.
      description: opts?.fullDescription
        ? card.description
        : card.description?.slice(0, 500),
      listName: card.list.name,
      listPublicId: card.list.publicId,
      dueDate: card.dueDate?.toISOString() ?? null,
      labels: card.labels.map((cl) => cl.label.name),
      checklists: card.checklists.map((cl) => ({
        name: cl.name,
        items: cl.items.map((i) => ({ title: i.title, completed: i.completed })),
      })),
      comments: card.comments.slice(-10).map((c) => ({
        author: c.author?.name ?? "unknown",
        comment: c.comment.slice(0, 500),
      })),
      siblings: siblings
        .filter((s) => s.publicId !== card.publicId)
        .slice(0, 20)
        .map((s) => ({ publicId: s.publicId, title: s.title })),
      recentActivity: card.activities
        .slice(0, 10)
        .map((a) => ({ type: a.type, at: a.createdAt.toISOString() })),
    },
  };
}

/** Best-effort git snapshot for tools runs — never fatal, scrubbed env. */
async function gitSnapshot(projectPath: string): Promise<string | null> {
  const run = (args: string[]) =>
    new Promise<string | null>((resolvePromise) => {
      execFile(
        "git",
        args,
        { cwd: projectPath, env: scrubEnv() as NodeJS.ProcessEnv, timeout: 5000 },
        (err, stdout) => resolvePromise(err ? null : stdout.trim()),
      );
    });
  try {
    const [branch, status] = await Promise.all([
      run(["rev-parse", "--abbrev-ref", "HEAD"]),
      run(["status", "--short"]),
    ]);
    if (branch === null && status === null) return null;
    return `Git snapshot of the project folder:\nbranch: ${branch ?? "unknown"}\nstatus (short):\n${status || "(clean)"}`;
  } catch {
    return null;
  }
}

async function requireJob(
  ctx: { db: Parameters<typeof assertPermission>[0]; user: { id: string } },
  jobId: string,
): Promise<JobRecord> {
  const job = await getJob(jobId);
  // Cross-workspace ids 404 (no existence leak): membership failure looks
  // identical to a missing job.
  if (!job || job.workspaceId === undefined) notFound("job");
  try {
    await assertPermission(ctx.db, ctx.user.id, job.workspaceId, "agent:run");
  } catch {
    notFound("job");
  }
  return job;
}

export const agentRouter = createTRPCRouter({
  listWorkers: protectedProcedure
    .meta({
      openapi: { method: "GET", path: "/agents/workers", tags: ["agent"] },
    })
    .input(z.void())
    .output(z.any())
    .query(({ ctx }) => {
      ensureAgentInfra(ctx.db);
      return {
        enabled: workersEnabled(),
        toolsAllowed: toolsAllowed(),
        projectRoots: projectRoots(),
        maxConcurrent: Number(process.env.KR8KAN_PI_MAX_CONCURRENT) || 4,
        runnerMode: "in-process",
        workers: WORKERS.map(
          ({ name, title, description, needs, allowTools, promptVersion }) => ({
            name,
            title,
            description,
            needs,
            allowTools: allowTools ?? false,
            promptVersion,
          }),
        ),
      };
    }),

  health: protectedProcedure
    .meta({
      openapi: { method: "GET", path: "/agents/health", tags: ["agent"] },
    })
    .input(z.void())
    .output(z.any())
    .query(async ({ ctx }) => {
      ensureAgentInfra(ctx.db);
      const health = await checkPiHealth();
      return {
        ...health,
        runnerMode: "in-process",
        toolsAllowed: toolsAllowed(),
        projectRoots: projectRoots(),
      };
    }),

  run: protectedProcedure
    .meta({
      openapi: { method: "POST", path: "/agents/run", tags: ["agent"] },
    })
    .input(
      z.object({
        worker: workerNameEnum,
        boardPublicId: z.string().length(12).nullish(),
        cardPublicId: z.string().length(12).nullish(),
        prompt: z.string().max(4000).nullish(),
      }),
    )
    .output(z.any())
    .mutation(async ({ ctx, input }) => {
      ensureAgentInfra(ctx.db);
      const definition = getWorker(input.worker);
      if (!definition) notFound("worker");
      if (!workersEnabled()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Pi workers are disabled (KR8KAN_PI_WORKERS_ENABLED=false)",
        });
      }

      const context: WorkerContext = {};
      let workspaceId: number | null = null;
      let boardPublicId = input.boardPublicId ?? undefined;
      let agentPath: string | null = null;
      let agentVerifyCommand: string | null = null;
      let cardId: number | null = null;

      if (input.cardPublicId) {
        const built = await buildCardContext(ctx.db, input.cardPublicId, {
          fullDescription: definition.allowTools,
        });
        context.card = built.context;
        workspaceId = built.workspaceId;
        boardPublicId ??= built.boardPublicId;
        agentPath = built.agentPath;
        agentVerifyCommand = built.agentVerifyCommand;
        cardId = built.cardId;
      }
      if (boardPublicId && definition.needs !== "card") {
        const built = await buildBoardContext(ctx.db, boardPublicId);
        context.board = built.context;
        workspaceId ??= built.workspaceId;
      }

      if (
        (definition.needs === "board" && !context.board) ||
        (definition.needs === "card" && !context.card)
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `worker ${definition.name} needs a ${definition.needs} context`,
        });
      }
      if (workspaceId === null) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "provide boardPublicId or cardPublicId",
        });
      }
      await assertPermission(ctx.db, ctx.user.id, workspaceId, "agent:run");

      // Per-user caps: N concurrent, M per hour.
      const [active, recent] = await Promise.all([
        agentJobRepo.countActiveJobsForUser(ctx.db, ctx.user.id),
        agentJobRepo.countRecentJobsForUser(ctx.db, ctx.user.id, 60 * 60 * 1000),
      ]);
      if (active >= maxActivePerUser()) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `You already have ${active} jobs running or queued (max ${maxActivePerUser()})`,
        });
      }
      if (recent >= maxRunsPerHour()) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Hourly run limit reached (${maxRunsPerHour()}/hour)`,
        });
      }

      if (definition.allowTools && !agentPath && boardPublicId) {
        const board = await boardRepo.getBoardByPublicId(ctx.db, boardPublicId);
        agentPath = board?.agentPath ?? null;
        agentVerifyCommand ??= board?.agentVerifyCommand ?? null;
      }
      if (definition.allowTools && !agentPath) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "This worker runs in a project folder — link one in board settings first",
        });
      }

      // Project-folder lock: one live tools job per folder, DB-enforced.
      let extraContext: string | undefined;
      if (definition.allowTools && agentPath) {
        const holder = await agentJobRepo.findActiveJobForProjectPath(
          ctx.db,
          agentPath,
        );
        if (holder) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Project folder is in use by job ${holder.publicId} (${holder.worker}, ${holder.status}) — wait or cancel it first`,
          });
        }
        extraContext = (await gitSnapshot(agentPath)) ?? undefined;
      }

      const db = ctx.db;
      const userId = ctx.user.id;
      const activityCardId = cardId;

      try {
        const job = await runWorker({
          worker: definition.name,
          context,
          prompt: input.prompt ?? undefined,
          workspaceId,
          boardPublicId,
          cardPublicId: input.cardPublicId ?? undefined,
          userId,
          projectPath: definition.allowTools ? (agentPath ?? undefined) : undefined,
          extraContext,
          verifyCommand: definition.allowTools
            ? (agentVerifyCommand ?? undefined)
            : undefined,
          onFinish: async (finished) => {
            if (activityCardId) {
              await cardRepo.recordActivity(db, {
                cardId: activityCardId,
                type: "agent.run.completed",
                userId,
                metadata: {
                  worker: finished.worker,
                  jobId: finished.id,
                  status: finished.status,
                },
              });
            }
          },
        });
        if (activityCardId) {
          await cardRepo.recordActivity(ctx.db, {
            cardId: activityCardId,
            type: "agent.run.started",
            userId: ctx.user.id,
            metadata: { worker: definition.name, jobId: job.id },
          });
        }
        return { jobId: job.id, status: job.status };
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: err instanceof Error ? err.message : "worker failed to start",
        });
      }
    }),

  status: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/agents/jobs/{jobId}",
        tags: ["agent"],
      },
    })
    .input(z.object({ jobId: z.string().min(1).max(32) }))
    .output(z.any())
    .query(async ({ ctx, input }) => {
      ensureAgentInfra(ctx.db);
      return requireJob(ctx, input.jobId);
    }),

  jobs: protectedProcedure
    .meta({
      openapi: { method: "GET", path: "/agents/jobs", tags: ["agent"] },
    })
    .input(
      z.object({
        workspacePublicId: z.string().length(12),
        boardPublicId: z.string().length(12).optional(),
        worker: workerNameEnum.optional(),
        status: jobStatusEnum.optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
    )
    .output(z.any())
    .query(async ({ ctx, input }) => {
      ensureAgentInfra(ctx.db);
      const workspace = await workspaceRepo.getWorkspaceByPublicId(
        ctx.db,
        input.workspacePublicId,
      );
      if (!workspace) notFound("workspace");
      await assertPermission(ctx.db, ctx.user.id, workspace.id, "agent:run");
      return listJobs({
        workspaceId: workspace.id,
        boardPublicId: input.boardPublicId,
        worker: input.worker,
        status: input.status,
        limit: input.limit ?? 20,
      });
    }),

  cancel: protectedProcedure
    .input(z.object({ jobId: z.string().min(1).max(32) }))
    .mutation(async ({ ctx, input }) => {
      ensureAgentInfra(ctx.db);
      const job = await requireJob(ctx, input.jobId);
      if (job.createdBy !== ctx.user.id) {
        const membership = await workspaceRepo.getMembership(
          ctx.db,
          ctx.user.id,
          job.workspaceId!,
        );
        if (!membership || !roleHasPermission(membership.role, "agent:manage")) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only the job owner or a workspace admin can cancel it",
          });
        }
      }
      const cancelled = await cancelJob(input.jobId);
      return { cancelled };
    }),

  apply: protectedProcedure
    .meta({
      openapi: { method: "POST", path: "/agents/apply", tags: ["agent"] },
    })
    .input(
      z.object({
        jobId: z.string().min(1).max(32),
        actions: z.array(applyActionSchema).min(1).max(20),
      }),
    )
    .output(z.any())
    .mutation(async ({ ctx, input }) => {
      ensureAgentInfra(ctx.db);
      const job = await requireJob(ctx, input.jobId);
      return applyJobActions(ctx.db, ctx.user.id, job, input.actions);
    }),
});
