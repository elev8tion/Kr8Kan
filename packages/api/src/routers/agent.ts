import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { JobRecord } from "@kr8kan/agents";
import {
  WORKERS,
  cancelJob,
  checkPiHealth,
  getJob,
  listJobs,
  projectRoots,
  toolsAllowed,
  workersEnabled,
} from "@kr8kan/agents";
import { customWorkerRepo, workflowRepo, workspaceRepo } from "@kr8kan/db";
import { roleHasPermission } from "@kr8kan/shared";

import { applyActionSchema, applyJobActions } from "../agentApply";
import { browserConfirmChannel } from "../browserConfirm";
import { applyJobPatch } from "../patchApply";
import { audit } from "../audit";
import { ensureAgentInfra } from "../agentStore";
import { dispatchWorker } from "../dispatchWorker";
import { assertPermission, notFound } from "../permissions";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * agent.* — Pi worker orchestration. Jobs are DB-backed (agent_job) and
 * workspace-scoped; the runner shells out to the operator's local `pi`
 * CLI (~/.pi agent layer). Works with session cookies or API keys.
 */

const jobStatusEnum = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

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
        // Stock worker name OR a workspace custom-worker name —
        // dispatchWorker resolves customs by name and 404s unknowns, so
        // an enum here would make custom workers undispatchable from the
        // runner UI and REST (only @mentions bypassed it).
        worker: z
          .string()
          .min(1)
          .max(64)
          .regex(/^[a-z0-9][a-z0-9-]*$/),
        boardPublicId: z.string().length(12).nullish(),
        cardPublicId: z.string().length(12).nullish(),
        prompt: z.string().max(4000).nullish(),
      }),
    )
    .output(z.any())
    .mutation(async ({ ctx, input }) => {
      ensureAgentInfra(ctx.db);
      try {
        const job = await dispatchWorker(ctx.db, ctx.user, {
          worker: input.worker,
          boardPublicId: input.boardPublicId ?? undefined,
          cardPublicId: input.cardPublicId ?? undefined,
          prompt: input.prompt ?? undefined,
        });
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
        // Plain string, not the stock enum: custom workers filter too.
        worker: z.string().max(64).optional(),
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

  /**
   * Gated browser actions waiting on a human. Scoped to the workspace, so
   * a pending confirm from another tenant is invisible rather than
   * merely unanswerable.
   */
  browserConfirms: protectedProcedure
    .input(
      z.object({
        workspacePublicId: z.string().length(12),
        jobId: z.string().min(1).max(32).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const workspace = await workspaceRepo.getWorkspaceByPublicId(
        ctx.db,
        input.workspacePublicId,
      );
      if (!workspace) notFound("workspace");
      await assertPermission(ctx.db, ctx.user.id, workspace.id, "agent:run");
      return browserConfirmChannel.list({
        workspaceId: workspace.id,
        jobId: input.jobId,
      });
    }),

  /**
   * Answer one. Approval is the privileged direction — it is what lets an
   * agent act on a page the rules flagged — so it needs agent:manage,
   * while anyone who can run a worker may deny.
   */
  browserConfirm: protectedProcedure
    .input(
      z.object({
        requestId: z.string().min(1).max(64),
        approved: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const pending = browserConfirmChannel.get(input.requestId);
      // An unknown id is indistinguishable from another workspace's id.
      if (!pending) return { matched: false, approved: false };

      await assertPermission(
        ctx.db,
        ctx.user.id,
        pending.workspaceId,
        input.approved ? "agent:manage" : "agent:run",
      );

      const outcome = browserConfirmChannel.respond(
        input.requestId,
        input.approved,
      );
      if (outcome.matched) {
        audit(ctx.db, {
          workspaceId: pending.workspaceId,
          eventType: input.approved
            ? "agent.browser.confirm.approved"
            : "agent.browser.confirm.denied",
          entityType: "agent_job",
          entityPublicId: pending.jobId,
          actorUserId: ctx.user.id,
          payload: {
            ruleName: pending.ruleName,
            summary: pending.summary,
            url: pending.url,
          },
        });
      }
      return outcome;
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

  /** Re-run a failed (or verify-failed) job with failure context injected —
   * same worker, board, card and prompt, linked back via retryOf. */
  rerun: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/agents/jobs/{jobId}/rerun",
        tags: ["agent"],
      },
    })
    .input(z.object({ jobId: z.string().min(1).max(32) }))
    .output(z.any())
    .mutation(async ({ ctx, input }) => {
      ensureAgentInfra(ctx.db);
      const prior = await requireJob(ctx, input.jobId);
      const retryable =
        prior.status === "failed" ||
        prior.status === "cancelled" ||
        prior.verifyStatus === "fail";
      if (!retryable) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Only failed, cancelled or verify-failed jobs can be re-run",
        });
      }
      try {
        const job = await dispatchWorker(ctx.db, ctx.user, {
          worker: prior.worker,
          boardPublicId: prior.boardPublicId,
          cardPublicId: prior.cardPublicId,
          prompt: prior.prompt,
          retryOfJobId: prior.id,
        });
        return { jobId: job.id, status: job.status };
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: err instanceof Error ? err.message : "worker failed to start",
        });
      }
    }),

  /** Apply a sandbox job's captured patch to the live linked folder.
   * Same gate a 👍 on the proposal comment goes through — strict check
   * first, honest conflict reporting, audited. */
  applyPatch: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/agents/jobs/{jobId}/apply-patch",
        tags: ["agent"],
      },
    })
    .input(z.object({ jobId: z.string().min(1).max(32) }))
    .output(z.any())
    .mutation(async ({ ctx, input }) => {
      ensureAgentInfra(ctx.db);
      const job = await requireJob(ctx, input.jobId);
      return applyJobPatch(ctx.db, ctx.user.id, job);
    }),

  // Named applyActions because `apply` is a tRPC reserved word (collides
  // with Function.prototype) — router construction throws on it at runtime.
  applyActions: protectedProcedure
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

  /* ── workspace-defined custom workers (persona packs) ─────────── */

  listCustomWorkers: protectedProcedure
    .input(z.object({ workspacePublicId: z.string().length(12) }))
    .query(async ({ ctx, input }) => {
      const workspace = await workspaceRepo.getWorkspaceByPublicId(
        ctx.db,
        input.workspacePublicId,
      );
      if (!workspace) notFound("workspace");
      await assertPermission(ctx.db, ctx.user.id, workspace.id, "agent:run");
      return customWorkerRepo.listCustomWorkers(ctx.db, workspace.id);
    }),

  createCustomWorker: protectedProcedure
    .input(
      z.object({
        workspacePublicId: z.string().length(12),
        name: z
          .string()
          .min(2)
          .max(64)
          .regex(/^[a-z0-9][a-z0-9-]+$/, "lowercase slug (a-z, 0-9, -)"),
        title: z.string().min(1).max(120),
        description: z.string().max(500).optional(),
        avatar: z.string().min(1).max(16).optional(),
        systemPrompt: z.string().min(20).max(8000),
        needs: z.enum(["board", "card", "either"]).optional(),
        outputMode: z.enum(["freeform", "schema"]).optional(),
        schemaWorker: z
          .enum([
            "draft-card",
            "triage-card",
            "breakdown-card",
            "standup",
            "summarize-board",
          ])
          .nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const workspace = await workspaceRepo.getWorkspaceByPublicId(
        ctx.db,
        input.workspacePublicId,
      );
      if (!workspace) notFound("workspace");
      await assertPermission(ctx.db, ctx.user.id, workspace.id, "agent:manage");
      if (WORKERS.some((w) => w.name === input.name)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `"${input.name}" collides with a stock worker name`,
        });
      }
      if (input.outputMode === "schema" && !input.schemaWorker) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "schema output mode needs a schemaWorker to borrow",
        });
      }
      const existing = await customWorkerRepo.getCustomWorkerByName(
        ctx.db,
        workspace.id,
        input.name,
      );
      if (existing) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `worker "${input.name}" already exists in this workspace`,
        });
      }
      const worker = await customWorkerRepo.createCustomWorker(ctx.db, {
        workspaceId: workspace.id,
        name: input.name,
        title: input.title,
        description: input.description,
        avatar: input.avatar,
        systemPrompt: input.systemPrompt,
        needs: input.needs ?? "either",
        outputMode: input.outputMode ?? "freeform",
        schemaWorker: input.outputMode === "schema" ? input.schemaWorker : null,
        createdBy: ctx.user.id,
      });
      audit(ctx.db, {
        workspaceId: workspace.id,
        eventType: "agent.custom.created",
        entityType: "custom_worker",
        entityPublicId: worker?.publicId,
        actorUserId: ctx.user.id,
        payload: { name: input.name, outputMode: input.outputMode ?? "freeform" },
      });
      return worker;
    }),

  updateCustomWorker: protectedProcedure
    .input(
      z.object({
        workerPublicId: z.string().length(12),
        title: z.string().min(1).max(120).optional(),
        description: z.string().max(500).nullish(),
        avatar: z.string().min(1).max(16).optional(),
        systemPrompt: z.string().min(20).max(8000).optional(),
        needs: z.enum(["board", "card", "either"]).optional(),
        outputMode: z.enum(["freeform", "schema"]).optional(),
        schemaWorker: z
          .enum([
            "draft-card",
            "triage-card",
            "breakdown-card",
            "standup",
            "summarize-board",
          ])
          .nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const worker = await customWorkerRepo.getCustomWorkerByPublicId(
        ctx.db,
        input.workerPublicId,
      );
      if (!worker) notFound("worker");
      await assertPermission(ctx.db, ctx.user.id, worker.workspaceId, "agent:manage");
      const updated = await customWorkerRepo.updateCustomWorker(ctx.db, worker.id, {
        title: input.title,
        description: input.description,
        avatar: input.avatar,
        systemPrompt: input.systemPrompt,
        needs: input.needs,
        outputMode: input.outputMode,
        schemaWorker: input.schemaWorker,
        // Prompt edits version-bump so old jobs keep their contract.
        promptVersion:
          input.systemPrompt && input.systemPrompt !== worker.systemPrompt
            ? worker.promptVersion + 1
            : undefined,
      });
      audit(ctx.db, {
        workspaceId: worker.workspaceId,
        eventType: "agent.custom.updated",
        entityType: "custom_worker",
        entityPublicId: worker.publicId,
        actorUserId: ctx.user.id,
      });
      return updated;
    }),

  deleteCustomWorker: protectedProcedure
    .input(z.object({ workerPublicId: z.string().length(12) }))
    .mutation(async ({ ctx, input }) => {
      const worker = await customWorkerRepo.getCustomWorkerByPublicId(
        ctx.db,
        input.workerPublicId,
      );
      if (!worker) notFound("worker");
      await assertPermission(ctx.db, ctx.user.id, worker.workspaceId, "agent:manage");
      await customWorkerRepo.updateCustomWorker(ctx.db, worker.id, {
        deletedAt: new Date(),
      });
      audit(ctx.db, {
        workspaceId: worker.workspaceId,
        eventType: "agent.custom.deleted",
        entityType: "custom_worker",
        entityPublicId: worker.publicId,
        actorUserId: ctx.user.id,
      });
      return { success: true };
    }),

  /** Per-worker usage aggregates + gate outcomes (operator dashboard). */
  stats: protectedProcedure
    .input(z.object({ workspacePublicId: z.string().length(12) }))
    .query(async ({ ctx, input }) => {
      ensureAgentInfra(ctx.db);
      const workspace = await workspaceRepo.getWorkspaceByPublicId(
        ctx.db,
        input.workspacePublicId,
      );
      if (!workspace) notFound("workspace");
      await assertPermission(ctx.db, ctx.user.id, workspace.id, "agent:run");

      const jobs = await listJobs({ workspaceId: workspace.id, limit: 500 });
      interface WorkerStats {
        worker: string;
        runs: number;
        completed: number;
        failed: number;
        cancelled: number;
        parseFailures: number;
        applies: number;
        verifyPass: number;
        verifyFail: number;
        durations: number[];
      }
      const byWorker = new Map<string, WorkerStats>();
      for (const job of jobs) {
        let s = byWorker.get(job.worker);
        if (!s) {
          s = {
            worker: job.worker,
            runs: 0,
            completed: 0,
            failed: 0,
            cancelled: 0,
            parseFailures: 0,
            applies: 0,
            verifyPass: 0,
            verifyFail: 0,
            durations: [],
          };
          byWorker.set(job.worker, s);
        }
        s.runs += 1;
        if (job.status === "completed") {
          s.completed += 1;
          if (job.startedAt && job.completedAt) {
            s.durations.push(
              Date.parse(job.completedAt) - Date.parse(job.startedAt),
            );
          }
        } else if (job.status === "failed") s.failed += 1;
        else if (job.status === "cancelled") s.cancelled += 1;
        if (job.parseError) s.parseFailures += 1;
        if (job.appliedActions?.length) s.applies += 1;
        if (job.verifyStatus === "pass") s.verifyPass += 1;
        if (job.verifyStatus === "fail") s.verifyFail += 1;
      }
      const workers = [...byWorker.values()]
        .map(({ durations, ...s }) => {
          const sorted = [...durations].sort((a, b) => a - b);
          return {
            ...s,
            medianDurationMs: sorted.length
              ? sorted[Math.floor(sorted.length / 2)]!
              : null,
          };
        })
        .sort((a, b) => b.runs - a.runs);

      // Gate outcomes from recent runs (approved/rejected read out of the
      // gate step's recorded detail; expired from the run error).
      const runs = await workflowRepo.listRuns(ctx.db, workspace.id, {
        limit: 200,
      });
      let gatesApproved = 0;
      let gatesRejected = 0;
      let gatesExpired = 0;
      for (const run of runs) {
        if (run.error === "gate expired") gatesExpired += 1;
        else if (run.error === "gate rejected") gatesRejected += 1;
        else {
          for (const step of run.stepResults ?? []) {
            if (step.type === "gate" && step.detail?.startsWith("approved")) {
              gatesApproved += 1;
            }
          }
        }
      }
      return {
        sampledJobs: jobs.length,
        workers,
        gates: {
          approved: gatesApproved,
          rejected: gatesRejected,
          expired: gatesExpired,
        },
      };
    }),
});
