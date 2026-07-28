import type { Database } from "@kr8kan/db";
import { boardNoteRepo } from "@kr8kan/db";

/**
 * Per-board serialization for board-note writes. Append mode is a
 * read-modify-write (getNote → concat → upsertNote) against NCB, which
 * has no compare-and-set and whose reads lag writes — two concurrent
 * appends both read the same base content and the second write drops the
 * first. The engine is single-instance by design (same justification as
 * claimedGates and the per-workspace audit queue), so the correct mutex
 * is in-process: chain note writes per board. The caller awaits its own
 * task, so a failed write still fails its own step; a failure never
 * poisons the chain for later writers.
 *
 * Serialization alone is not enough: NCB reads lag writes by 2–4s, so a
 * queued writer's getNote can still return the note as it was BEFORE the
 * previous writer in the same queue committed. lastWritten keeps the most
 * recent content this process wrote per board; within the lag window a DB
 * read that is a strict prefix of it is our own stale echo and the cached
 * value wins. A human replace in the same window is not a prefix, so a
 * genuinely newer external edit still wins.
 */
const noteQueues = new Map<number, Promise<void>>();
const lastWritten = new Map<number, { content: string; at: number }>();

/** NCB read-after-write lag is 2–4s; stay authoritative comfortably past it. */
const READ_YOUR_WRITES_WINDOW_MS = 20_000;

export function serializeBoardNoteWrite(
  boardId: number,
  task: () => Promise<void>,
): Promise<void> {
  const tail = noteQueues.get(boardId) ?? Promise.resolve();
  const next = tail.then(task);
  const settled = next.catch(() => undefined);
  noteQueues.set(boardId, settled);
  // Don't let the map grow forever on quiet boards.
  void settled.finally(() => {
    if (noteQueues.get(boardId) === settled) noteQueues.delete(boardId);
  });
  return next;
}

/** Current note content with read-your-writes: must only be called from
 * inside a serializeBoardNoteWrite task for the same board. */
async function readCurrentNote(
  db: Database,
  boardId: number,
): Promise<string | null> {
  const row = await boardNoteRepo.getNote(db, boardId);
  const dbContent = row?.content ?? null;
  const cached = lastWritten.get(boardId);
  if (cached && Date.now() - cached.at < READ_YOUR_WRITES_WINDOW_MS) {
    if (dbContent === null || cached.content.startsWith(dbContent)) {
      return cached.content;
    }
  }
  return dbContent;
}

/** Single entry point for every engine/apply write to a board note. */
export async function writeBoardNoteSerialized(
  db: Database,
  opts: {
    boardId: number;
    body: string;
    mode: "append" | "replace";
    /** Rendered into the append separator line, e.g. workflow or worker name. */
    separatorLabel: string;
    userId: string;
    agentIdentityId?: number | null;
  },
): Promise<void> {
  await serializeBoardNoteWrite(opts.boardId, async () => {
    let content = opts.body;
    if (opts.mode === "append") {
      const existing = await readCurrentNote(db, opts.boardId);
      const separator = `\n\n---\n_${opts.separatorLabel} · ${new Date().toISOString().slice(0, 10)}_\n\n`;
      content = existing ? `${existing}${separator}${opts.body}` : opts.body;
    }
    await boardNoteRepo.upsertNote(db, {
      boardId: opts.boardId,
      content,
      userId: opts.userId,
      agentIdentityId: opts.agentIdentityId ?? null,
    });
    lastWritten.set(opts.boardId, { content, at: Date.now() });
  });
}
