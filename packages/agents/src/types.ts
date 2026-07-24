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
  piModel?: string;
  toolsUsed?: boolean;
  promptVersion?: number;
  /** Live progress line for long tools runs (last tool + last text). */
  progress?: string;
  verifyStatus?: "pass" | "fail";
  verifyLog?: string;
  appliedActions?: AppliedAction[];
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
