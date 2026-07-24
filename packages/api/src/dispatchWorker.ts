import { execFile } from "node:child_process";
import { TRPCError } from "@trpc/server";

import type {
  JobRecord,
  WorkerBoardContext,
  WorkerCardContext,
  WorkerContext,
} from "@kr8kan/agents";
import {
  SCHEMA_CONTRACT_SNIPPETS,
  buildFailureContext,
  getJob,
  getWorker,
  runWorker,
  scrubEnv,
  toolsAllowed,
  workersEnabled,
} from "@kr8kan/agents";
import type { CustomWorkerRow, Database } from "@kr8kan/db";
import {
  agentIdentityRepo,
  agentJobRepo,
  boardRepo,
  cardRepo,
  customWorkerRepo,
} from "@kr8kan/db";

import { audit } from "./audit";
import { assertPermission, notFound } from "./permissions";

/**
 * The one path every worker run goes through — UI mutation, REST, comment
 * @mention, workflow step. Same context building, caps, tools checks,
 * folder lock, identity, activity + audit rows regardless of dispatcher.
 */

function maxActivePerUser(): number {
  const raw = Number(process.env.KR8KAN_PI_MAX_PER_USER);
  return Number.isFinite(raw) && raw > 0 ? raw : 3;
}

function maxRunsPerHour(): number {
  const raw = Number(process.env.KR8KAN_PI_MAX_PER_HOUR);
  return Number.isFinite(raw) && raw > 0 ? raw : 30;
}

export async function buildBoardContext(
  db: Database,
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

export async function buildCardContext(
  db: Database,
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
  const siblings = await cardRepo.listCardsByList(db, card.listId);
  return {
    workspaceId: card.list.board.workspaceId,
    boardPublicId: card.list.board.publicId,
    agentPath: card.list.board.agentPath,
    agentVerifyCommand: card.list.board.agentVerifyCommand,
    cardId: card.id,
    context: {
      publicId: card.publicId,
      // dev-task gets the full card; advisory workers get a capped slice.
      description: opts?.fullDescription
        ? card.description
        : card.description?.slice(0, 500),
      title: card.title,
      listName: card.list.name,
      listPublicId: card.list.publicId,
      dueDate: card.dueDate?.toISOString() ?? null,
      labels: card.labels.map((cl) => cl.label.name),
      checklists: card.checklists.map((cl) => ({
        name: cl.name,
        items: cl.items.map((i) => ({ title: i.title, completed: i.completed })),
      })),
      comments: card.comments.slice(-10).map((c) => ({
        author: c.agent?.displayName ?? c.author?.name ?? "unknown",
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

/** Registered by callers that need to know when a specific job settles
 * (workflow steps await their runWorker jobs this way — no polling). */
const finishWaiters = new Map<string, (job: JobRecord) => void>();

export function waitForJob(jobId: string, timeoutMs: number): Promise<JobRecord | null> {
  return new Promise((resolvePromise) => {
    const timer = setTimeout(() => {
      finishWaiters.delete(jobId);
      resolvePromise(null);
    }, timeoutMs);
    finishWaiters.set(jobId, (job) => {
      clearTimeout(timer);
      finishWaiters.delete(jobId);
      resolvePromise(job);
    });
  });
}

export interface DispatchInput {
  worker: string;
  boardPublicId?: string;
  cardPublicId?: string;
  prompt?: string;
  /** Comment that @mentioned the worker — the result posts back there. */
  sourceCommentPublicId?: string;
  /** Failed job this dispatch retries — its error, verify tail and event
   * trace are injected into the new run's context. */
  retryOfJobId?: string;
}

export async function dispatchWorker(
  db: Database,
  operator: { id: string },
  input: DispatchInput,
): Promise<JobRecord> {
  // Two-source resolution: stock registry first, then the workspace's
  // custom workers (advisory-only, resolved once workspaceId is known).
  const stock = getWorker(input.worker);
  if (!workersEnabled()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Pi workers are disabled (KR8KAN_PI_WORKERS_ENABLED=false)",
    });
  }

  const context: WorkerContext = {};
  let workspaceId: number | null = null;
  let boardPublicId = input.boardPublicId;
  let agentPath: string | null = null;
  let agentVerifyCommand: string | null = null;
  let cardId: number | null = null;

  if (input.cardPublicId) {
    const built = await buildCardContext(db, input.cardPublicId, {
      fullDescription: stock?.allowTools,
    });
    context.card = built.context;
    workspaceId = built.workspaceId;
    boardPublicId ??= built.boardPublicId;
    agentPath = built.agentPath;
    agentVerifyCommand = built.agentVerifyCommand;
    cardId = built.cardId;
  }
  if (boardPublicId && stock?.needs !== "card") {
    const built = await buildBoardContext(db, boardPublicId);
    context.board = built.context;
    workspaceId ??= built.workspaceId;
  }

  if (workspaceId === null) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "provide boardPublicId or cardPublicId",
    });
  }

  let custom: CustomWorkerRow | null = null;
  if (!stock) {
    custom =
      (await customWorkerRepo.getCustomWorkerByName(
        db,
        workspaceId,
        input.worker,
      )) ?? null;
    if (!custom) notFound("worker");
  }
  const definition = stock ?? {
    name: custom!.name,
    title: custom!.title,
    description: custom!.description ?? "",
    needs: custom!.needs as "board" | "card" | "either" | "none",
    promptFile: "",
    promptVersion: custom!.promptVersion,
    allowTools: false,
  };

  if (
    (definition.needs === "board" && !context.board) ||
    (definition.needs === "card" && !context.card)
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `worker ${definition.name} needs a ${definition.needs} context`,
    });
  }
  await assertPermission(db, operator.id, workspaceId, "agent:run");

  // Per-user caps: N concurrent, M per hour — counted against the operator.
  const [active, recent] = await Promise.all([
    agentJobRepo.countActiveJobsForUser(db, operator.id),
    agentJobRepo.countRecentJobsForUser(db, operator.id, 60 * 60 * 1000),
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
    const board = await boardRepo.getBoardByPublicId(db, boardPublicId);
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
    const holder = await agentJobRepo.findActiveJobForProjectPath(db, agentPath);
    if (holder) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `Project folder is in use by job ${holder.publicId} (${holder.worker}, ${holder.status}) — wait or cancel it first`,
      });
    }
    extraContext = (await gitSnapshot(agentPath)) ?? undefined;
  }

  // Retry lineage: fold a bounded digest of the failed attempt (error,
  // verify tail, event trace) into the new run's context. Cross-workspace
  // ids are silently ignored — the retry endpoint permission-checks, this
  // is defence in depth.
  if (input.retryOfJobId) {
    const prior = await getJob(input.retryOfJobId);
    if (prior && prior.workspaceId === workspaceId) {
      const failure = buildFailureContext(prior);
      if (failure) {
        extraContext = [extraContext, failure].filter(Boolean).join("\n\n");
      }
    }
  }

  const identity = await agentIdentityRepo.ensureIdentity(
    db,
    workspaceId,
    definition.name,
    custom
      ? {
          kind: "custom",
          displayName: custom.title,
          avatar: custom.avatar,
          createdBy: custom.createdBy ?? undefined,
        }
      : undefined,
  );

  // Custom workers: personality from the row, output contract injected
  // when a stock schema is borrowed — drift impossible by construction.
  let systemPromptOverride: string | undefined;
  let schemaWorker: string | undefined;
  if (custom) {
    systemPromptOverride = custom.systemPrompt;
    if (custom.outputMode === "schema" && custom.schemaWorker) {
      schemaWorker = custom.schemaWorker;
      systemPromptOverride += SCHEMA_CONTRACT_SNIPPETS[custom.schemaWorker] ?? "";
    }
  }

  const userId = operator.id;
  const activityCardId = cardId;
  const wsId = workspaceId;

  const job = await runWorker({
    worker: definition.name,
    context,
    prompt: input.prompt,
    workspaceId,
    boardPublicId,
    cardPublicId: input.cardPublicId,
    userId,
    agentIdentityId: identity.id,
    sourceCommentPublicId: input.sourceCommentPublicId,
    retryOfJobId: input.retryOfJobId,
    systemPromptOverride,
    schemaWorker,
    promptVersionOverride: custom?.promptVersion,
    projectPath: definition.allowTools ? (agentPath ?? undefined) : undefined,
    extraContext,
    verifyCommand: definition.allowTools ? (agentVerifyCommand ?? undefined) : undefined,
    onFinish: async (finished) => {
      if (activityCardId) {
        await cardRepo.recordActivity(db, {
          cardId: activityCardId,
          type: "agent.run.completed",
          userId,
          agentIdentityId: identity.id,
          metadata: {
            worker: finished.worker,
            jobId: finished.id,
            status: finished.status,
          },
        });
      }
      audit(db, {
        workspaceId: wsId,
        eventType: "agent.run.completed",
        entityType: "agent_job",
        entityPublicId: finished.id,
        actorUserId: userId,
        actorAgentId: identity.id,
        payload: {
          worker: finished.worker,
          status: finished.status,
          parseError: finished.parseError ?? null,
        },
      });
      // Mention-dispatched runs reply in the thread they came from.
      if (
        input.sourceCommentPublicId &&
        activityCardId &&
        finished.status === "completed" &&
        finished.result
      ) {
        await postMentionReply(db, {
          cardId: activityCardId,
          job: finished,
          operatorId: userId,
          agentIdentityId: identity.id,
          workspaceId: wsId,
        });
      }
      const waiter = finishWaiters.get(finished.id);
      if (waiter) waiter(finished);
    },
  });

  if (activityCardId) {
    await cardRepo.recordActivity(db, {
      cardId: activityCardId,
      type: "agent.run.started",
      userId,
      agentIdentityId: identity.id,
      metadata: { worker: definition.name, jobId: job.id },
    });
  }
  audit(db, {
    workspaceId,
    eventType: "agent.run.started",
    entityType: "agent_job",
    entityPublicId: job.id,
    actorUserId: userId,
    actorAgentId: identity.id,
    payload: {
      worker: definition.name,
      cardPublicId: input.cardPublicId ?? null,
      viaMention: Boolean(input.sourceCommentPublicId),
      retryOf: input.retryOfJobId ?? null,
    },
  });
  return job;
}

const REPLY_MAX = 4000;

async function postMentionReply(
  db: Database,
  input: {
    cardId: number;
    job: JobRecord;
    operatorId: string;
    agentIdentityId: number;
    workspaceId: number;
  },
): Promise<void> {
  const { job } = input;
  let body = job.result ?? "";
  if (body.length > REPLY_MAX) body = `${body.slice(0, REPLY_MAX)}\n\n_[truncated — see job ${job.id}]_`;
  if (job.resultParsed !== undefined && !job.parseError) {
    body += `\n\n---\n_Structured proposal ready — open the job to review and apply._ \`job:${job.id}\``;
  }
  const reply = await cardRepo.addComment(db, {
    cardId: input.cardId,
    comment: body,
    userId: input.operatorId,
    agentIdentityId: input.agentIdentityId,
  });
  // Agent replies audit like every other agent surface.
  audit(db, {
    workspaceId: input.workspaceId,
    eventType: "agent.reply.posted",
    entityType: "comment",
    entityPublicId: reply?.publicId,
    actorUserId: input.operatorId,
    actorAgentId: input.agentIdentityId,
    payload: { worker: job.worker, jobId: job.id },
  });
}
