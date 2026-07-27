import type { Database } from "@kr8kan/db";
import { auditLogRepo } from "@kr8kan/db";
import { createLogger } from "@kr8kan/logger";

const logger = createLogger("audit");

/**
 * Per-workspace append queue. The hash chain's UNIQUE(workspace_id, seq)
 * makes every append a serialization point; concurrent bursts (bulk API
 * testing, workflow fan-out) thrash the collision-retry loop — one winner
 * per round, everyone else re-reads a lagging NCB tail and collides
 * again. The engine is single-instance by design, so the correct mutex
 * is in-process: chain appends per workspace and collisions cannot
 * happen at all. The repo's retry loop remains as a backstop for
 * multi-process misuse.
 */
const queues = new Map<number, Promise<void>>();

/**
 * Fire-and-forget append to the workspace hash chain. Audit failure is
 * logged loudly but never blocks or fails the mutation it describes.
 */
export function audit(
  db: Database,
  entry: {
    workspaceId: number;
    eventType: string;
    entityType: string;
    entityPublicId?: string | null;
    actorUserId?: string | null;
    actorAgentId?: number | null;
    payload?: unknown;
  },
): void {
  const tail = queues.get(entry.workspaceId) ?? Promise.resolve();
  const next = tail
    .then(() => auditLogRepo.append(db, entry))
    .then(
      () => undefined,
      (err: unknown) => {
        logger.error(
          { err, eventType: entry.eventType, workspace: entry.workspaceId },
          "audit append failed",
        );
      },
    );
  queues.set(entry.workspaceId, next);
  // Don't let the map grow forever on quiet workspaces.
  void next.finally(() => {
    if (queues.get(entry.workspaceId) === next) queues.delete(entry.workspaceId);
  });
}
