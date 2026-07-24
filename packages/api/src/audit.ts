import type { Database } from "@kr8kan/db";
import { auditLogRepo } from "@kr8kan/db";
import { createLogger } from "@kr8kan/logger";

const logger = createLogger("audit");

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
  void auditLogRepo.append(db, entry).catch((err: unknown) => {
    logger.error(
      { err, eventType: entry.eventType, workspace: entry.workspaceId },
      "audit append failed",
    );
  });
}
