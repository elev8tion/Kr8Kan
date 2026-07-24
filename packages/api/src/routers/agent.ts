import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { WorkerBoardContext, WorkerCardContext, WorkerContext } from "@kr8kan/agents";
import {
  WORKERS,
  cancelJob,
  checkPiHealth,
  getJob,
  getWorker,
  listJobs,
  projectRoots,
  runWorker,
  toolsAllowed,
  workersEnabled,
} from "@kr8kan/agents";
import { boardRepo, cardRepo } from "@kr8kan/db";

import { assertPermission, notFound } from "../permissions";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * agent.* — Pi worker orchestration. The runner shells out to the
 * operator's local `pi` CLI (~/.pi agent layer); jobs are file-backed
 * under .kr8kan/jobs. Works with session cookies or API keys.
 */

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
): Promise<{
  context: WorkerCardContext;
  workspaceId: number;
  boardPublicId: string;
  agentPath: string | null;
}> {
  const card = await cardRepo.getCardByPublicId(db, cardPublicId);
  if (!card) notFound("card");
  return {
    workspaceId: card.list.board.workspaceId,
    boardPublicId: card.list.board.publicId,
    agentPath: card.list.board.agentPath,
    context: {
      publicId: card.publicId,
      title: card.title,
      description: card.description,
      listName: card.list.name,
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
    },
  };
}

export const agentRouter = createTRPCRouter({
  listWorkers: protectedProcedure
    .meta({
      openapi: { method: "GET", path: "/agents/workers", tags: ["agent"] },
    })
    .input(z.void())
    .output(z.any())
    .query(() => ({
      enabled: workersEnabled(),
      toolsAllowed: toolsAllowed(),
      projectRoots: projectRoots(),
      workers: WORKERS.map(
        ({ name, title, description, needs, allowTools }) => ({
          name,
          title,
          description,
          needs,
          allowTools: allowTools ?? false,
        }),
      ),
    })),

  health: protectedProcedure
    .meta({
      openapi: { method: "GET", path: "/agents/health", tags: ["agent"] },
    })
    .input(z.void())
    .output(z.any())
    .query(() => checkPiHealth()),

  run: protectedProcedure
    .meta({
      openapi: { method: "POST", path: "/agents/run", tags: ["agent"] },
    })
    .input(
      z.object({
        worker: z.string().min(1).max(64),
        boardPublicId: z.string().length(12).nullish(),
        cardPublicId: z.string().length(12).nullish(),
        prompt: z.string().max(4000).nullish(),
      }),
    )
    .output(z.any())
    .mutation(async ({ ctx, input }) => {
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

      if (input.cardPublicId) {
        const built = await buildCardContext(ctx.db, input.cardPublicId);
        context.card = built.context;
        workspaceId = built.workspaceId;
        boardPublicId ??= built.boardPublicId;
        agentPath = built.agentPath;
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

      if (definition.allowTools && !agentPath && boardPublicId) {
        const board = await boardRepo.getBoardByPublicId(ctx.db, boardPublicId);
        agentPath = board?.agentPath ?? null;
      }
      if (definition.allowTools && !agentPath) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "This worker runs in a project folder — link one in board settings first",
        });
      }

      try {
        const job = await runWorker({
          worker: definition.name,
          context,
          prompt: input.prompt ?? undefined,
          boardPublicId,
          cardPublicId: input.cardPublicId ?? undefined,
          userId: ctx.user.id,
          projectPath: definition.allowTools ? (agentPath ?? undefined) : undefined,
        });
        return { jobId: job.id, status: job.status };
      } catch (err) {
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
    .query(async ({ input }) => {
      const job = await getJob(input.jobId);
      if (!job) notFound("job");
      return job;
    }),

  jobs: protectedProcedure
    .meta({
      openapi: { method: "GET", path: "/agents/jobs", tags: ["agent"] },
    })
    .input(z.object({ limit: z.number().int().min(1).max(100).optional() }).optional())
    .output(z.any())
    .query(({ input }) => listJobs(input?.limit ?? 20)),

  cancel: protectedProcedure
    .input(z.object({ jobId: z.string().min(1).max(32) }))
    .mutation(async ({ input }) => {
      const cancelled = cancelJob(input.jobId);
      return { cancelled };
    }),
});
