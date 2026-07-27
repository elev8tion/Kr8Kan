import { generateUID } from "@kr8kan/shared";

import type { Database } from "../client";
import type { agentIdentities } from "../schema";

export type AgentIdentityRow = typeof agentIdentities.$inferSelect;

/** Stock worker display metadata for lazily provisioned identities. */
const STOCK_AVATARS: Record<string, { avatar: string; displayName: string }> = {
  "summarize-board": { avatar: "📋", displayName: "Board Summarizer" },
  "draft-card": { avatar: "📝", displayName: "Card Drafter" },
  "triage-card": { avatar: "🧭", displayName: "Triage" },
  "breakdown-card": { avatar: "🧩", displayName: "Breakdown" },
  standup: { avatar: "📣", displayName: "Standup" },
  "dev-task": { avatar: "🛠️", displayName: "Dev Agent" },
  custom: { avatar: "✨", displayName: "Custom Prompt" },
};

/**
 * Get-or-create the identity row for a worker in a workspace. Stock
 * identities are provisioned lazily on first use; custom workers create
 * theirs explicitly with their own metadata.
 */
export async function ensureIdentity(
  db: Database,
  workspaceId: number,
  workerName: string,
  overrides?: {
    kind?: "stock" | "custom";
    displayName?: string;
    avatar?: string;
    createdBy?: string;
  },
): Promise<AgentIdentityRow> {
  const existing = (await db.findFirst("agentIdentities", {
    where: { workspaceId, workerName },
  })) as AgentIdentityRow | undefined;
  if (existing) return existing;

  const stock = STOCK_AVATARS[workerName];
  // insertIfAbsent replaces onConflictDoNothing: on a lost insert race it
  // returns the winner's row (deleted-inclusive, like the old re-read).
  const { row } = await db.insertIfAbsent(
    "agentIdentities",
    {
      publicId: generateUID(),
      workspaceId,
      workerName,
      kind: overrides?.kind ?? "stock",
      displayName:
        overrides?.displayName ?? stock?.displayName ?? workerName,
      avatar: overrides?.avatar ?? stock?.avatar ?? "🤖",
      createdBy: overrides?.createdBy,
    },
    ["workspaceId", "workerName"],
  );
  if (!row) throw new Error("failed to provision agent identity");
  return row as AgentIdentityRow;
}

export async function getIdentityById(db: Database, id: number) {
  return (await db.findFirst("agentIdentities", {
    where: { id },
    includeDeleted: true,
  })) as AgentIdentityRow | undefined;
}

export async function listIdentities(db: Database, workspaceId: number) {
  return (await db.findMany("agentIdentities", {
    where: { workspaceId },
  })) as AgentIdentityRow[];
}

export async function updateIdentity(
  db: Database,
  id: number,
  patch: { displayName?: string; avatar?: string; deletedAt?: Date | null },
) {
  return (await db.update("agentIdentities", id, patch)) as
    | AgentIdentityRow
    | undefined;
}
