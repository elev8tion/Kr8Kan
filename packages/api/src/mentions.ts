import { WORKERS } from "@kr8kan/agents";
import type { Database } from "@kr8kan/db";
import { customWorkerRepo, workspaceRepo } from "@kr8kan/db";
import { createLogger } from "@kr8kan/logger";
import { roleHasPermission } from "@kr8kan/shared";

import { dispatchWorker } from "./dispatchWorker";

const logger = createLogger("mentions");

const MENTION_RE = /@([a-z0-9][a-z0-9-]{1,63})/g;
const MAX_MENTIONS_PER_COMMENT = 2;

export interface MentionResult {
  dispatched: { worker: string; jobId: string }[];
  /** Human-readable reasons for mentions that did not dispatch. */
  skipped: { worker: string; reason: string }[];
}

/**
 * @worker mentions in card comments (Buzz: agents act in-thread). The
 * comment always posts; mentions dispatch through the same
 * dispatchWorker path as the UI — same permissions, caps, locks. A
 * guest's mention posts fine and dispatches nothing, with the reason
 * surfaced back to the UI.
 */
export async function handleCommentMentions(
  db: Database,
  user: { id: string },
  input: {
    workspaceId: number;
    cardPublicId: string;
    boardPublicId?: string;
    commentBody: string;
    commentPublicId: string;
  },
): Promise<MentionResult> {
  const result: MentionResult = { dispatched: [], skipped: [] };

  const names = new Set<string>();
  for (const match of input.commentBody.matchAll(MENTION_RE)) {
    names.add(match[1]!.toLowerCase());
  }
  if (names.size === 0) return result;

  const stockNames = new Set(WORKERS.map((w) => w.name));
  const customs = await customWorkerRepo.listCustomWorkers(db, input.workspaceId);
  const customNames = new Set(customs.map((c) => c.name));
  const workerNames = [...names].filter(
    (n) => stockNames.has(n) || customNames.has(n),
  );
  if (workerNames.length === 0) return result;

  const membership = await workspaceRepo.getMembership(
    db,
    user.id,
    input.workspaceId,
  );
  if (!membership || !roleHasPermission(membership.role, "agent:run")) {
    for (const worker of workerNames) {
      result.skipped.push({
        worker,
        reason: "mentioning a worker requires the agent:run permission",
      });
    }
    return result;
  }

  // The comment minus the mention tokens becomes the prompt.
  const prompt = input.commentBody.replace(MENTION_RE, "").trim() || undefined;

  for (const worker of workerNames.slice(0, MAX_MENTIONS_PER_COMMENT)) {
    try {
      const job = await dispatchWorker(db, user, {
        worker,
        cardPublicId: input.cardPublicId,
        boardPublicId: input.boardPublicId,
        prompt,
        sourceCommentPublicId: input.commentPublicId,
      });
      result.dispatched.push({ worker, jobId: job.id });
    } catch (err) {
      const reason = err instanceof Error ? err.message : "dispatch failed";
      result.skipped.push({ worker, reason });
      logger.warn({ worker, reason }, "mention dispatch failed");
    }
  }
  for (const worker of workerNames.slice(MAX_MENTIONS_PER_COMMENT)) {
    result.skipped.push({ worker, reason: "max 2 worker mentions per comment" });
  }
  return result;
}
