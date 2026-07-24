import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createLogger } from "@kr8kan/logger";
import { generateUID } from "@kr8kan/shared";

import { getWorker } from "./registry";
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
import type { JobRecord, WorkerContext } from "./types";

const logger = createLogger("agents");

/**
 * Pi invocation (verified against the installed pi CLI, an
 * @mariozechner/pi-style coding agent):
 *
 *   pi --print --no-session --mode text \
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

const inFlight = new Map<string, ChildProcess>();

async function jobDir(): Promise<string> {
  const dir = resolveJobDir(repoRoot());
  await mkdir(dir, { recursive: true });
  return dir;
}

async function writeJob(job: JobRecord): Promise<void> {
  const dir = await jobDir();
  await writeFile(join(dir, `${job.id}.json`), JSON.stringify(job, null, 2));
}

export async function getJob(id: string): Promise<JobRecord | null> {
  if (!/^[a-z0-9]{1,32}$/.test(id)) return null;
  try {
    const dir = await jobDir();
    return JSON.parse(await readFile(join(dir, `${id}.json`), "utf8"));
  } catch {
    return null;
  }
}

export async function listJobs(limit = 20): Promise<JobRecord[]> {
  try {
    const dir = await jobDir();
    const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
    const jobs: JobRecord[] = [];
    for (const file of files) {
      try {
        jobs.push(JSON.parse(await readFile(join(dir, file), "utf8")));
      } catch {
        // skip unreadable job files
      }
    }
    return jobs
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  } catch {
    return [];
  }
}

export function cancelJob(id: string): boolean {
  const child = inFlight.get(id);
  if (!child) return false;
  // SIGKILL on purpose: this pi build ignores/outlives SIGTERM.
  child.kill("SIGKILL");
  return true;
}

export function workersEnabled(): boolean {
  return process.env.KR8KAN_PI_WORKERS_ENABLED !== "false";
}

export interface RunWorkerInput {
  worker: string;
  context: WorkerContext;
  prompt?: string;
  boardPublicId?: string;
  cardPublicId?: string;
  userId?: string;
  /** For tool-enabled workers: absolute project folder (validated against
   * KR8KAN_PI_PROJECT_ROOTS) that pi will run inside, with tools. */
  projectPath?: string;
}

/** Start a worker; returns the job id immediately (file-based job store). */
export async function runWorker(input: RunWorkerInput): Promise<JobRecord> {
  const definition = getWorker(input.worker);
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

  const job: JobRecord = {
    id: generateUID(16),
    worker: definition.name,
    status: "pending",
    prompt: input.prompt,
    boardPublicId: input.boardPublicId,
    cardPublicId: input.cardPublicId,
    createdBy: input.userId,
    createdAt: new Date().toISOString(),
  };
  await writeJob(job);

  const systemPrompt = await loadSystemPrompt(definition.promptFile);
  const userMessage = redactForModel(
    [
      input.prompt ? `Operator request:\n${input.prompt}` : null,
      input.context.board
        ? `Board context (JSON):\n${JSON.stringify(input.context.board, null, 2)}`
        : null,
      input.context.card
        ? `Card context (JSON):\n${JSON.stringify(input.context.card, null, 2)}`
        : null,
    ]
      .filter(Boolean)
      .join("\n\n") || "No additional context provided.",
  );

  void execute(job, systemPrompt, userMessage, projectPath);
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

async function execute(
  job: JobRecord,
  systemPrompt: string,
  userMessage: string,
  projectPath?: string,
): Promise<void> {
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

  job.status = "running";
  job.startedAt = new Date().toISOString();
  if (projectPath) job.projectPath = projectPath;
  await writeJob(job);
  logger.info(
    { job: job.id, worker: job.worker, cwd: projectPath ?? repoRoot(), tools: withTools },
    "pi worker started",
  );

  const child = spawn(piBin, args, {
    cwd: projectPath ?? repoRoot(),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  inFlight.set(job.id, child);

  let stderr = "";
  let lineBuffer = "";
  let lastAssistant = "";
  let settled = false;
  let truncated = false;

  child.stdout.on("data", (chunk: Buffer) => {
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
          message?: { role?: string };
          messages?: { role?: string }[];
        };
        if (event.type === "message_end" && event.message?.role === "assistant") {
          const text = textFromMessage(event.message);
          if (text.trim()) lastAssistant = text;
        } else if (event.type === "agent_end" && Array.isArray(event.messages)) {
          for (const m of event.messages) {
            if (m?.role === "assistant") {
              const text = textFromMessage(m);
              if (text.trim()) lastAssistant = text;
            }
          }
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
      child.kill("SIGKILL");
    },
    withTools ? toolRunTimeoutMs() : WORKER_TIMEOUT_MS,
  );

  let finalized = false;
  const finalize = (code: number | null) => {
    if (finalized) return;
    finalized = true;
    clearTimeout(timeout);
    inFlight.delete(job.id);
    job.completedAt = new Date().toISOString();
    const result = lastAssistant.trim();
    if (settled && result) {
      job.status = "completed";
      job.result = truncated ? `${result}\n\n_[output truncated]_` : result;
    } else if (!settled && !result) {
      job.status = "cancelled";
      job.error = "worker cancelled or timed out before answering";
    } else if (result) {
      job.status = "completed";
      job.result = result;
    } else {
      job.status = "failed";
      job.error = stderr.trim() || `pi exited with code ${code} and no output`;
    }
    void writeJob(job);
    logger.info({ job: job.id, status: job.status }, "pi worker finished");
  };

  child.on("error", (err) => {
    if (finalized) return;
    finalized = true;
    clearTimeout(timeout);
    inFlight.delete(job.id);
    job.status = "failed";
    job.error = `failed to launch ${piBin}: ${err.message}. Is the Pi CLI installed and on PATH (PI_BIN)?`;
    job.completedAt = new Date().toISOString();
    void writeJob(job);
  });

  child.on("close", (code) => finalize(code));
  // A grandchild can hold the stdio pipes open past process death, so
  // 'close' may never fire — 'exit' + a short drain grace is the backstop.
  child.on("exit", (code) => {
    setTimeout(() => finalize(code), 500);
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
