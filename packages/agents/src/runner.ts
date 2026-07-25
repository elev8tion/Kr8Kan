import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createLogger } from "@kr8kan/logger";
import { generateUID } from "@kr8kan/shared";

import { pushEvent } from "./events";
import { collectContextIds } from "./grounding";
import { UNTRUSTED_WARNING, screenUntrusted } from "./injection";
import { parseWorkerResult } from "./parse";
import { getWorker } from "./registry";
import type { Sandbox } from "./sandbox";
import {
  capturePatch,
  createSandbox,
  isGitRepo,
  removeSandbox,
} from "./sandbox";
import {
  MAX_OUTPUT_BYTES,
  WORKER_TIMEOUT_MS,
  redactForModel,
  resolveJobDir,
  resolveProjectPath,
  scrubEnv,
  toolRunTimeoutMs,
  toolsAllowed,
} from "./safety";
import type {
  JobEvent,
  JobRecord,
  JobStatus,
  JobStore,
  WorkerContext,
} from "./types";

const logger = createLogger("agents");

/**
 * Pi invocation (verified against the installed pi CLI, an
 * @mariozechner/pi-style coding agent):
 *
 *   pi --print --no-session --mode json \
 *      [--no-tools] [--model <KR8KAN_PI_MODEL>] \
 *      --system-prompt "<worker system prompt>" \
 *      "<user message: operator prompt + JSON context>"
 *
 * `--print` runs non-interactively and exits; `--no-session` keeps worker
 * runs out of the operator's session history; `--no-tools` (default unless
 * KR8KAN_PI_ALLOW_TOOLS=true) means workers can only *recommend* actions.
 * Model/provider config comes from the operator's global ~/.pi
 * (PI_AGENT_HOME) — Kr8Kan deliberately does not ship its own AI vendor.
 */

function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = join(dir, "..");
  }
  return process.cwd();
}

function promptsDir(): string | null {
  const candidates: string[] = [];
  try {
    candidates.push(join(dirname(fileURLToPath(import.meta.url)), "prompts"));
  } catch {
    // bundled
  }
  candidates.push(join(repoRoot(), "packages", "agents", "src", "prompts"));
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

async function loadSystemPrompt(promptFile: string): Promise<string> {
  const dir = promptsDir();
  if (dir) {
    try {
      return await readFile(join(dir, promptFile), "utf8");
    } catch {
      // fall through
    }
  }
  return "You are a Kr8Kan kanban board worker. Answer in concise markdown grounded in the provided JSON context. Do not invent entities.";
}

/* ── job store ─────────────────────────────────────────────────────
 * Default: flat JSON files under .kr8kan/jobs (standalone / CLI use).
 * The API layer injects a DB-backed store via setJobStore() so jobs
 * survive restarts and get workspace tenancy. */

function fileJobStore(): JobStore {
  const dir = async () => {
    const d = resolveJobDir(repoRoot());
    await mkdir(d, { recursive: true });
    return d;
  };
  const read = async (id: string): Promise<JobRecord | null> => {
    if (!/^[a-z0-9]{1,32}$/.test(id)) return null;
    try {
      return JSON.parse(
        await readFile(join(await dir(), `${id}.json`), "utf8"),
      ) as JobRecord;
    } catch {
      return null;
    }
  };
  return {
    async create(job) {
      await writeFile(
        join(await dir(), `${job.id}.json`),
        JSON.stringify(job, null, 2),
      );
    },
    async update(id, patch) {
      const job = await read(id);
      if (!job) return;
      Object.assign(job, patch);
      await writeFile(
        join(await dir(), `${id}.json`),
        JSON.stringify(job, null, 2),
      );
    },
    get: read,
    async list(filters) {
      try {
        const d = await dir();
        const files = (await readdir(d)).filter((f) => f.endsWith(".json"));
        const jobs: JobRecord[] = [];
        for (const file of files) {
          try {
            jobs.push(JSON.parse(await readFile(join(d, file), "utf8")));
          } catch {
            // skip unreadable job files
          }
        }
        return jobs
          .filter((j) => !filters?.workspaceId || j.workspaceId === filters.workspaceId)
          .filter((j) => !filters?.boardPublicId || j.boardPublicId === filters.boardPublicId)
          .filter((j) => !filters?.worker || j.worker === filters.worker)
          .filter((j) => !filters?.status || j.status === filters.status)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, filters?.limit ?? 20);
      } catch {
        return [];
      }
    },
  };
}

let store: JobStore = fileJobStore();

/** Inject a durable store (the API layer passes a DB-backed one). */
export function setJobStore(next: JobStore): void {
  store = next;
}

export function getJobStore(): JobStore {
  return store;
}

export async function getJob(id: string): Promise<JobRecord | null> {
  return store.get(id);
}

export async function listJobs(
  filters?: Parameters<JobStore["list"]>[0],
): Promise<JobRecord[]> {
  return store.list(filters);
}

/* ── concurrency ───────────────────────────────────────────────────
 * Global cap + a lower cap for tools runs. Over-cap jobs stay `pending`
 * in an in-process FIFO; statuses persist, so a crash leaves clean
 * pending rows the reaper can fail out. */

function maxConcurrent(): number {
  const raw = Number(process.env.KR8KAN_PI_MAX_CONCURRENT);
  return Number.isFinite(raw) && raw > 0 ? raw : 4;
}

function maxConcurrentTools(): number {
  const raw = Number(process.env.KR8KAN_PI_MAX_CONCURRENT_TOOLS);
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

interface QueuedRun {
  job: JobRecord;
  systemPrompt: string;
  userMessage: string;
  projectPath?: string;
  verifyCommand?: string;
  onFinish?: (job: JobRecord) => Promise<void>;
}

const queue: QueuedRun[] = [];
let running = 0;
let runningTools = 0;

function drainQueue(): void {
  while (queue.length > 0 && running < maxConcurrent()) {
    const next = queue[0]!;
    const isTools = Boolean(next.job.toolsUsed);
    if (isTools && runningTools >= maxConcurrentTools()) {
      // Head-of-line is a tools run and the tools lane is full — look for
      // a non-tools run further back before giving up this drain pass.
      const idx = queue.findIndex((q) => !q.job.toolsUsed);
      if (idx === -1) return;
      const [run] = queue.splice(idx, 1);
      startRun(run!);
      continue;
    }
    queue.shift();
    startRun(next);
  }
}

function startRun(run: QueuedRun): void {
  if (cancelledJobs.has(run.job.id)) return;
  running += 1;
  if (run.job.toolsUsed) runningTools += 1;
  void execute(run).finally(() => {
    running -= 1;
    if (run.job.toolsUsed) runningTools -= 1;
    drainQueue();
  });
}

const inFlight = new Map<string, ChildProcess>();
const cancelledJobs = new Set<string>();

/**
 * Cancel a job. Persists `cancelled` FIRST, then kills the process if
 * alive — a dead/orphaned process still gets its status flipped.
 */
export async function cancelJob(id: string): Promise<boolean> {
  const job = await store.get(id);
  if (!job) return false;
  if (job.status !== "pending" && job.status !== "running") return false;
  cancelledJobs.add(id);
  await store.update(id, {
    status: "cancelled",
    error: "cancelled by operator",
    completedAt: new Date().toISOString(),
  });
  const queued = queue.findIndex((q) => q.job.id === id);
  if (queued !== -1) queue.splice(queued, 1);
  const child = inFlight.get(id);
  if (child) {
    // SIGKILL on purpose: this pi build ignores/outlives SIGTERM.
    child.kill("SIGKILL");
  }
  return true;
}

export function workersEnabled(): boolean {
  return process.env.KR8KAN_PI_WORKERS_ENABLED !== "false";
}

export interface RunWorkerInput {
  worker: string;
  context: WorkerContext;
  prompt?: string;
  workspaceId?: number;
  boardPublicId?: string;
  cardPublicId?: string;
  userId?: string;
  /** DB id of the agent identity this run acts as (opaque to the runner). */
  agentIdentityId?: number;
  /** Comment publicId this run was @mention-dispatched from. */
  sourceCommentPublicId?: string;
  /** Custom (workspace-defined) workers: full system prompt to use
   * instead of a registry prompt file. Never grants tools. */
  systemPromptOverride?: string;
  /** Custom workers: stock worker whose output schema this borrows. */
  schemaWorker?: string;
  /** Custom workers: prompt version stamped on the job. */
  promptVersionOverride?: number;
  /** For tool-enabled workers: absolute project folder (validated against
   * KR8KAN_PI_PROJECT_ROOTS) that pi will run inside, with tools. */
  projectPath?: string;
  /** Extra context blocks the API layer prepends (e.g. git snapshot). */
  extraContext?: string;
  /** Board-configured shell command run after a tools job completes;
   * exit code + output tail land in verifyStatus/verifyLog. */
  verifyCommand?: string;
  /** Sandbox mode for tools runs. `undefined` (default): sandbox when the
   * project folder is a git repo, live-edit fallback otherwise (marked
   * unsandboxed on the job). `true`: sandbox required — non-git folders
   * are rejected. `false`: force live edit. */
  sandbox?: boolean;
  /** publicId of a failed job this run retries (stamped on the record). */
  retryOfJobId?: string;
  /** Called once after the job reaches a terminal state and is persisted
   * (not called for operator cancels). Lets the API layer write activity
   * rows without the runner knowing about the db. */
  onFinish?: (job: JobRecord) => Promise<void>;
}

/** Denylist appended to tool-enabled system prompts. Prompt-level only —
 * tools remain powerful; the real rails are the folder allowlist + env
 * scrub. Keep this honest in docs. */
const TOOLS_DENY_NOTE = `

## Hard rules for tool use
- NEVER run \`git push\`, force-push, or publish anything to a remote.
- NEVER run destructive recursive deletes (\`rm -rf\` outside a scratch subfolder).
- NEVER run network installers or pipe remote scripts to a shell (curl|sh, npm -g, brew install).
- NEVER commit unless the operator's request explicitly asks for a commit.
- Stay inside the project folder you were started in.`;

/** Start a worker; returns the job id immediately. */
export async function runWorker(input: RunWorkerInput): Promise<JobRecord> {
  let definition = getWorker(input.worker);
  if (!definition && input.systemPromptOverride) {
    // Workspace-defined custom worker: advisory-only synthetic definition.
    definition = {
      name: input.worker,
      title: input.worker,
      description: "custom worker",
      needs: "either",
      promptFile: "",
      promptVersion: input.promptVersionOverride ?? 1,
    };
  }
  if (!definition) throw new Error(`unknown worker: ${input.worker}`);
  if (!workersEnabled()) throw new Error("Pi workers are disabled");

  let projectPath: string | undefined;
  if (definition.allowTools) {
    if (!toolsAllowed()) {
      throw new Error(
        `worker ${definition.name} runs with tools — opt in with KR8KAN_PI_ALLOW_TOOLS=true`,
      );
    }
    if (!input.projectPath) {
      throw new Error(
        `worker ${definition.name} needs a project folder — link one in board settings`,
      );
    }
    projectPath = resolveProjectPath(input.projectPath);
    if (!existsSync(projectPath)) {
      throw new Error(`project folder does not exist: ${projectPath}`);
    }
  }

  const withTools = Boolean(projectPath) && toolsAllowed();

  // Sandbox resolution: tools runs execute in a detached git worktree by
  // default; non-git folders fall back to live edit (marked on the job)
  // unless the caller made the sandbox mandatory.
  let sandbox = false;
  if (withTools && projectPath && input.sandbox !== false) {
    sandbox = await isGitRepo(projectPath);
    if (!sandbox && input.sandbox === true) {
      throw new Error(
        `sandbox required but ${projectPath} is not a git repository`,
      );
    }
  }

  // Eval layer: remember exactly which entity ids the worker was shown
  // (grounding ground-truth), and screen untrusted content for injection
  // patterns — flag-only, never blocks.
  const contextIds = collectContextIds(input.context);
  const promptFlags = screenUntrusted(
    [
      input.prompt ?? "",
      input.context.board ? JSON.stringify(input.context.board) : "",
      input.context.card ? JSON.stringify(input.context.card) : "",
      input.context.channel ? JSON.stringify(input.context.channel) : "",
    ].join("\n"),
  );

  const job: JobRecord = {
    id: generateUID(16),
    worker: definition.name,
    status: "pending",
    prompt: input.prompt,
    workspaceId: input.workspaceId,
    boardPublicId: input.boardPublicId,
    cardPublicId: input.cardPublicId,
    createdBy: input.userId,
    agentIdentityId: input.agentIdentityId,
    sourceCommentPublicId: input.sourceCommentPublicId,
    schemaWorker: input.schemaWorker,
    createdAt: new Date().toISOString(),
    projectPath,
    piModel: process.env.KR8KAN_PI_MODEL,
    toolsUsed: withTools,
    sandbox,
    promptVersion: definition.promptVersion,
    retryOf: input.retryOfJobId,
    contextIds: contextIds.length ? contextIds : undefined,
    promptFlags: promptFlags.length ? promptFlags : undefined,
  };
  await store.create(job);

  let systemPrompt =
    input.systemPromptOverride ?? (await loadSystemPrompt(definition.promptFile));
  if (withTools) systemPrompt += TOOLS_DENY_NOTE;
  const userMessage = redactForModel(
    [
      input.prompt ? `Operator request:\n${input.prompt}` : null,
      promptFlags.length ? UNTRUSTED_WARNING : null,
      input.extraContext ?? null,
      input.context.board
        ? `Board context (JSON):\n${JSON.stringify(input.context.board, null, 2)}`
        : null,
      input.context.card
        ? `Card context (JSON):\n${JSON.stringify(input.context.card, null, 2)}`
        : null,
      input.context.channel
        ? `Channel conversation (JSON):\n${JSON.stringify(input.context.channel, null, 2)}`
        : null,
    ]
      .filter(Boolean)
      .join("\n\n") || "No additional context provided.",
  );

  queue.push({
    job,
    systemPrompt,
    userMessage,
    projectPath,
    verifyCommand: input.verifyCommand,
    onFinish: input.onFinish,
  });
  drainQueue();
  return job;
}

/** Pull the text blocks out of a pi json-mode message. */
function textFromMessage(message: unknown): string {
  const m = message as
    | { content?: string | { type?: string; text?: string }[] }
    | undefined;
  if (!m) return "";
  if (typeof m.content === "string") return m.content;
  if (Array.isArray(m.content)) {
    return m.content
      .filter((b) => b?.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("\n");
  }
  return "";
}

const PROGRESS_MAX = 400;
const PROGRESS_FLUSH_MS = 2000;

async function execute(run: QueuedRun): Promise<void> {
  const { job, systemPrompt, userMessage, projectPath, verifyCommand, onFinish } =
    run;
  const piBin = process.env.PI_BIN ?? "pi";
  // json mode is load-bearing: the installed pi CLI does not reliably exit
  // after --print (a child keeps the stdio open), so we watch the event
  // stream for `agent_settled` and terminate the process ourselves.
  const args = ["--print", "--no-session", "--mode", "json"];
  // Advisory workers never get tools; dev workers get them only when the
  // operator opted in AND the board is linked to an allowlisted folder.
  const withTools = Boolean(projectPath) && toolsAllowed();
  if (!withTools) args.push("--no-tools");
  if (process.env.KR8KAN_PI_MODEL) {
    args.push("--model", process.env.KR8KAN_PI_MODEL);
  }
  args.push("--system-prompt", systemPrompt, userMessage);

  const env = scrubEnv();
  if (process.env.PI_AGENT_HOME) {
    // pi resolves its config from $HOME/.pi — point HOME at the parent of
    // PI_AGENT_HOME when the operator overrides it.
    env.PI_DIR = process.env.PI_AGENT_HOME;
  }

  if (cancelledJobs.has(job.id)) {
    cancelledJobs.delete(job.id);
    return;
  }
  job.status = "running";
  job.startedAt = new Date().toISOString();
  await store.update(job.id, { status: "running", startedAt: job.startedAt });
  // Re-check after the async write: a cancel that landed in between must
  // not be clobbered by the running status.
  if (cancelledJobs.has(job.id)) {
    cancelledJobs.delete(job.id);
    await store.update(job.id, {
      status: "cancelled",
      error: "cancelled by operator",
      completedAt: new Date().toISOString(),
    });
    return;
  }
  // Bounded event ring: every parsed pi event plus runner transitions.
  // Persisted once at finalize — the trace is for replay, not live view.
  const events: JobEvent[] = [];

  // Sandbox: tools runs marked sandboxed get a detached worktree; the
  // agent (and verify) run there, and changes are captured as a patch.
  // Sandbox creation failure fails the job — never a silent live-edit.
  let sandbox: Sandbox | null = null;
  if (job.sandbox && projectPath) {
    try {
      sandbox = await createSandbox(projectPath, job.id);
      pushEvent(events, "sandbox.created", sandbox.worktreeDir);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      pushEvent(events, "sandbox.error", message);
      pushEvent(events, "worker.failed");
      await store.update(job.id, {
        status: "failed",
        error: `sandbox creation failed: ${message}`,
        completedAt: new Date().toISOString(),
        events: [...events],
      });
      if (onFinish) {
        const finalJob = await store.get(job.id);
        if (finalJob) {
          await onFinish(finalJob).catch((hookErr: unknown) =>
            logger.warn({ job: job.id, err: hookErr }, "onFinish hook failed"),
          );
        }
      }
      return;
    }
  }
  const execCwd = sandbox?.cwd ?? projectPath ?? repoRoot();

  logger.info(
    {
      job: job.id,
      worker: job.worker,
      cwd: execCwd,
      tools: withTools,
      sandbox: Boolean(sandbox),
    },
    "pi worker started",
  );

  const child = spawn(piBin, args, {
    cwd: execCwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  inFlight.set(job.id, child);

  let stderr = "";
  let lineBuffer = "";
  let lastAssistant = "";
  let settled = false;
  let truncated = false;
  let bytesOut = 0;
  let spawnError: string | null = null;

  pushEvent(events, "worker.spawned", `${job.worker}${withTools ? " (tools)" : ""}`);

  // Live progress: last tool + last assistant snippet, flushed at most
  // every PROGRESS_FLUSH_MS to keep DB writes bounded.
  let progress = "";
  let progressDirty = false;
  let lastFlush = 0;
  const setProgress = (text: string) => {
    progress = text.length > PROGRESS_MAX ? `${text.slice(0, PROGRESS_MAX)}…` : text;
    progressDirty = true;
    const now = Date.now();
    if (now - lastFlush >= PROGRESS_FLUSH_MS) {
      lastFlush = now;
      progressDirty = false;
      void store.update(job.id, { progress });
    }
  };

  child.stdout.on("data", (chunk: Buffer) => {
    bytesOut += chunk.length;
    lineBuffer += chunk.toString("utf8");
    if (lastAssistant.length >= MAX_OUTPUT_BYTES) {
      truncated = true;
      settled = true;
      child.kill("SIGKILL");
      return;
    }
    let newline = lineBuffer.indexOf("\n");
    while (newline !== -1) {
      const line = lineBuffer.slice(0, newline).trim();
      lineBuffer = lineBuffer.slice(newline + 1);
      newline = lineBuffer.indexOf("\n");
      if (!line.startsWith("{")) continue;
      try {
        const event = JSON.parse(line) as {
          type?: string;
          toolName?: string;
          tool_name?: string;
          message?: { role?: string };
          messages?: { role?: string }[];
        };
        // Trace every non-delta event (deltas would spam the ring out).
        if (typeof event.type === "string" && !event.type.includes("delta")) {
          const tool = event.toolName ?? event.tool_name;
          const text =
            event.type === "message_end" || event.type === "agent_end"
              ? textFromMessage(event.message).trim()
              : "";
          pushEvent(events, event.type, tool ?? (text || undefined));
        }
        if (event.type === "message_end" && event.message?.role === "assistant") {
          const text = textFromMessage(event.message);
          if (text.trim()) {
            lastAssistant = text;
            setProgress(text.trim().slice(-PROGRESS_MAX));
          }
        } else if (event.type === "agent_end" && Array.isArray(event.messages)) {
          for (const m of event.messages) {
            if (m?.role === "assistant") {
              const text = textFromMessage(m);
              if (text.trim()) lastAssistant = text;
            }
          }
        } else if (
          event.type === "tool_execution_start" ||
          event.type === "tool_execution_end"
        ) {
          const tool = event.toolName ?? event.tool_name ?? "tool";
          setProgress(
            `${event.type === "tool_execution_start" ? "running" : "finished"} ${tool}`,
          );
        } else if (event.type === "agent_settled") {
          settled = true;
          // pi lingers after settling — reap it; finalize runs on exit.
          child.kill("SIGKILL");
        }
      } catch {
        // partial or non-JSON line — ignore
      }
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    if (stderr.length < 16_384) stderr += chunk.toString("utf8");
  });

  const timeout = setTimeout(
    () => {
      logger.warn({ job: job.id }, "pi worker timed out");
      pushEvent(events, "worker.timeout");
      child.kill("SIGKILL");
    },
    withTools ? toolRunTimeoutMs() : WORKER_TIMEOUT_MS,
  );

  await new Promise<void>((resolveDone) => {
    let finalized = false;
    const finalize = (code: number | null) => {
      if (finalized) return;
      finalized = true;
      clearTimeout(timeout);
      inFlight.delete(job.id);
      void (async () => {
        const completedAt = new Date().toISOString();
        const patch: Partial<JobRecord> = { completedAt, progress: undefined };
        const result = lastAssistant.trim();
        let status: JobStatus;
        if (cancelledJobs.has(job.id)) {
          // cancelJob already persisted `cancelled` — do not overwrite.
          cancelledJobs.delete(job.id);
          resolveDone();
          return;
        }
        if (spawnError) {
          status = "failed";
          patch.error = spawnError;
        } else if (settled && result) {
          status = "completed";
          patch.result = truncated ? `${result}\n\n_[output truncated]_` : result;
        } else if (!settled && !result) {
          status = "cancelled";
          patch.error = "worker cancelled or timed out before answering";
        } else if (result) {
          status = "completed";
          patch.result = result;
        } else {
          status = "failed";
          patch.error = stderr.trim() || `pi exited with code ${code} and no output`;
        }
        patch.status = status;
        pushEvent(events, `worker.${status}`);

        // Sandbox: capture the worktree's changes as the job's patch
        // artifact before anything downstream (onFinish, proposals) reads
        // the job. Capture is best-effort — a diff failure is recorded,
        // never fatal.
        if (sandbox && status !== "cancelled") {
          try {
            const captured = await capturePatch(sandbox);
            if (captured) {
              patch.patch = captured.patch;
              patch.patchSummary = captured.summary;
              patch.patchTruncated = captured.truncated;
              pushEvent(
                events,
                captured.truncated
                  ? "sandbox.patch_truncated"
                  : "sandbox.patch_captured",
                captured.summary,
              );
            } else {
              pushEvent(events, "sandbox.no_changes");
            }
          } catch (err) {
            pushEvent(
              events,
              "sandbox.patch_error",
              err instanceof Error ? err.message : String(err),
            );
          }
        }
        // Structured-output contract: parse on completion. Parse failure
        // is not run failure — the job stays completed, apply is blocked.
        if (status === "completed" && patch.result) {
          const parsed = parseWorkerResult(
            job.schemaWorker ?? job.worker,
            patch.result,
          );
          if (parsed.ok) patch.resultParsed = parsed.data;
          else patch.parseError = parsed.error;
        }

        // Post-run verification (board-configured command, tools runs
        // only). Sandboxed runs verify inside the worktree — the live
        // tree is never touched before a human applies the patch. Runs
        // before the terminal persist so the worktree can be removed
        // first: a terminal status must imply the sandbox is gone.
        if (status === "completed" && projectPath && verifyCommand) {
          const verdict = await runVerifyCommand(
            sandbox?.cwd ?? projectPath,
            verifyCommand,
          );
          pushEvent(events, `verify.${verdict.verifyStatus}`);
          Object.assign(patch, verdict);
        }
        patch.events = [...events];

        if (sandbox) {
          await removeSandbox(sandbox);
        }

        await store.update(job.id, patch);

        if (onFinish) {
          const finalJob = await store.get(job.id);
          if (finalJob) {
            await onFinish(finalJob).catch((err: unknown) =>
              logger.warn({ job: job.id, err }, "onFinish hook failed"),
            );
          }
        }

        const startedMs = job.startedAt ? Date.parse(job.startedAt) : Date.now();
        logger.info(
          {
            job: job.id,
            status,
            worker: job.worker,
            tools: withTools,
            duration_ms: Date.parse(completedAt) - startedMs,
            bytes_out: bytesOut,
          },
          "pi worker finished",
        );
        resolveDone();
      })();
    };

    // Spawn errors finalize through the normal path so onFinish still
    // fires — sentinel triggers and workflow waiters must see the failure.
    child.on("error", (err) => {
      spawnError = `failed to launch ${piBin}: ${err.message}. Is the Pi CLI installed and on PATH (PI_BIN)?`;
      pushEvent(events, "worker.spawn_error", err.message);
      finalize(null);
    });

    child.on("close", (code) => finalize(code));
    // A grandchild can hold the stdio pipes open past process death, so
    // 'close' may never fire — 'exit' + a short drain grace is the backstop.
    child.on("exit", (code) => {
      setTimeout(() => finalize(code), 500);
    });
  });
  // Backstop cleanup for paths that skip the terminal persist (cancel's
  // early return). removeSandbox is idempotent — the finalize path
  // already removed it on success/failure.
  if (sandbox) {
    await removeSandbox(sandbox);
  }
  void progressDirty; // final state already persisted above
}

const VERIFY_LOG_MAX = 4096;

/** Exported for the API layer: patch apply re-verifies in the live tree. */
export async function runVerifyCommand(
  cwd: string,
  command: string,
): Promise<Pick<JobRecord, "verifyStatus" | "verifyLog">> {
  return new Promise((resolveVerify) => {
    const child = spawn("sh", ["-c", command], {
      cwd,
      env: scrubEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const capture = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.length > VERIFY_LOG_MAX * 4) {
        output = output.slice(-VERIFY_LOG_MAX * 2);
      }
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, toolRunTimeoutMs());
    const done = (code: number | null) => {
      clearTimeout(timer);
      resolveVerify({
        verifyStatus: code === 0 ? "pass" : "fail",
        verifyLog: `$ ${command}\n${output.slice(-VERIFY_LOG_MAX)}${
          code === 0 ? "" : `\n[exit ${code ?? "killed"}]`
        }`,
      });
    };
    child.on("error", (err) =>
      resolveVerify({ verifyStatus: "fail", verifyLog: `failed to run: ${err.message}` }),
    );
    child.on("close", done);
  });
}

/** Health probe for Settings → Agents: is the pi binary reachable? */
export async function checkPiHealth(): Promise<{
  ok: boolean;
  piBin: string;
  agentHome: string;
  enabled: boolean;
  detail?: string;
}> {
  const piBin = process.env.PI_BIN ?? "pi";
  const agentHome =
    process.env.PI_AGENT_HOME ?? join(process.env.HOME ?? "~", ".pi");
  const enabled = workersEnabled();
  return new Promise((resolvePromise) => {
    const child = spawn(piBin, ["--help"], {
      env: scrubEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolvePromise({
        ok: false,
        piBin,
        agentHome,
        enabled,
        detail: "pi --help timed out",
      });
    }, 10_000);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolvePromise({ ok: false, piBin, agentHome, enabled, detail: err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({
        ok: code === 0,
        piBin,
        agentHome,
        enabled,
        detail: code === 0 ? undefined : `pi --help exited with ${code}`,
      });
    });
  });
}
