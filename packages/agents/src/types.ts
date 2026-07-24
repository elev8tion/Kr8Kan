export interface WorkerCardContext {
  publicId: string;
  title: string;
  description?: string | null;
  listName?: string;
  listPublicId?: string;
  labels?: string[];
  dueDate?: string | null;
  checklists?: { name: string; items: { title: string; completed: boolean }[] }[];
  comments?: { author: string; comment: string }[];
  /** Sibling cards in the same list (title + publicId), for placement context. */
  siblings?: { publicId: string; title: string }[];
  recentActivity?: { type: string; at: string }[];
}

export interface WorkerBoardContext {
  publicId: string;
  name: string;
  lists: {
    publicId: string;
    name: string;
    cards: WorkerCardContext[];
  }[];
  labels?: { publicId: string; name: string }[];
  recentActivity?: { type: string; cardTitle: string; at: string }[];
}

/** Structured, secret-free context passed to a Pi worker. */
export interface WorkerContext {
  board?: WorkerBoardContext;
  card?: WorkerCardContext;
}

export type JobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/** One entry in a job's bounded event trace (see events.ts for caps). */
export interface JobEvent {
  /** ISO timestamp the runner saw the event. */
  at: string;
  /** pi event type or runner transition (worker.spawned, verify.fail, …). */
  type: string;
  /** Truncated payload snippet: tool name, message text, log tail. */
  detail?: string;
}

export interface AppliedAction {
  index: number;
  entityPublicId?: string;
  at: string;
}

export interface JobRecord {
  id: string;
  worker: string;
  status: JobStatus;
  prompt?: string;
  workspaceId?: number;
  boardPublicId?: string;
  cardPublicId?: string;
  createdBy?: string;
  /** Raw final assistant text. */
  result?: string;
  /** Schema-validated payload extracted from the fenced JSON block. */
  resultParsed?: unknown;
  /** Set when the worker completed but its output failed the schema. */
  parseError?: string;
  error?: string;
  stdout?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  /** Set for tool-enabled runs: the folder pi worked in. */
  projectPath?: string;
  /** DB id of the agent identity this run acts as (API-side concern). */
  agentIdentityId?: number;
  /** Custom workers: stock worker whose output schema + apply preset
   * this run borrows (parse + apply key). */
  schemaWorker?: string;
  /** Set when the run was dispatched from an @worker comment mention. */
  sourceCommentPublicId?: string;
  piModel?: string;
  toolsUsed?: boolean;
  promptVersion?: number;
  /** Live progress line for long tools runs (last tool + last text). */
  progress?: string;
  verifyStatus?: "pass" | "fail";
  verifyLog?: string;
  /** Tools run executed in an isolated git worktree — the live linked
   * folder was never touched; changes land as `patch`. */
  sandbox?: boolean;
  /** Unified diff captured from the sandbox (bounded — see sandbox.ts). */
  patch?: string;
  /** Human summary of the patch, e.g. "3 files changed, +42 −7". */
  patchSummary?: string;
  /** Patch exceeded the size cap — stored truncated, apply blocked. */
  patchTruncated?: boolean;
  /** Set when a human applied the patch to the live folder. */
  patchAppliedAt?: string;
  /** Last patch-apply failure (conflict, lock, verify context). */
  patchApplyError?: string;
  appliedActions?: AppliedAction[];
  /** Bounded event trace captured during the run (replayable "smoke"). */
  events?: JobEvent[];
  /** publicId of the failed job this run is a retry of. */
  retryOf?: string;
  /** Every entity publicId that was present in the worker's prompt
   * context — the ground-truth set for grounding checks. */
  contextIds?: string[];
  /** Eval-layer verdict on this job's output. `grounding_failed` and
   * `judge_failed` block the gated apply path. */
  evalStatus?: "grounding_failed" | "judge_pass" | "judge_warn" | "judge_failed";
  /** Human-readable reasons behind evalStatus. */
  evalReasons?: string[];
  /** Injection-heuristic patterns that fired on content interpolated into
   * this run's prompt (flag-only — never blocks). */
  promptFlags?: string[];
}

/**
 * Persistence boundary for jobs. `packages/agents` has no db dependency —
 * the API layer injects a DB-backed store; the default is file-based so
 * the package stays spawnable/testable standalone.
 */
export interface JobStore {
  create(job: JobRecord): Promise<void>;
  update(id: string, patch: Partial<JobRecord>): Promise<void>;
  get(id: string): Promise<JobRecord | null>;
  list(filters?: {
    workspaceId?: number;
    boardPublicId?: string;
    worker?: string;
    status?: JobStatus;
    limit?: number;
  }): Promise<JobRecord[]>;
}
