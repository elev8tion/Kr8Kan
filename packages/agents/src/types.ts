export interface WorkerCardContext {
  publicId: string;
  title: string;
  description?: string | null;
  listName?: string;
  labels?: string[];
  dueDate?: string | null;
  checklists?: { name: string; items: { title: string; completed: boolean }[] }[];
  comments?: { author: string; comment: string }[];
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

export interface JobRecord {
  id: string;
  worker: string;
  status: JobStatus;
  prompt?: string;
  boardPublicId?: string;
  cardPublicId?: string;
  createdBy?: string;
  result?: string;
  error?: string;
  stdout?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  /** Set for tool-enabled runs: the folder pi worked in. */
  projectPath?: string;
}
