import { and, eq, isNull } from "drizzle-orm";

import { generateUID } from "@kr8kan/shared";

import type { Database } from "../client";
import { agentIdentities } from "../schema";

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
  const existing = await db.query.agentIdentities.findFirst({
    where: and(
      eq(agentIdentities.workspaceId, workspaceId),
      eq(agentIdentities.workerName, workerName),
      isNull(agentIdentities.deletedAt),
    ),
  });
  if (existing) return existing;

  const stock = STOCK_AVATARS[workerName];
  const [row] = await db
    .insert(agentIdentities)
    .values({
      publicId: generateUID(),
      workspaceId,
      workerName,
      kind: overrides?.kind ?? "stock",
      displayName:
        overrides?.displayName ?? stock?.displayName ?? workerName,
      avatar: overrides?.avatar ?? stock?.avatar ?? "🤖",
      createdBy: overrides?.createdBy,
    })
    .onConflictDoNothing()
    .returning();
  if (row) return row;
  // Lost a concurrent insert race — re-read.
  const raced = await db.query.agentIdentities.findFirst({
    where: and(
      eq(agentIdentities.workspaceId, workspaceId),
      eq(agentIdentities.workerName, workerName),
    ),
  });
  if (!raced) throw new Error("failed to provision agent identity");
  return raced;
}

export async function getIdentityById(db: Database, id: number) {
  return db.query.agentIdentities.findFirst({
    where: eq(agentIdentities.id, id),
  });
}

export async function listIdentities(db: Database, workspaceId: number) {
  return db.query.agentIdentities.findMany({
    where: and(
      eq(agentIdentities.workspaceId, workspaceId),
      isNull(agentIdentities.deletedAt),
    ),
  });
}

export async function updateIdentity(
  db: Database,
  id: number,
  patch: { displayName?: string; avatar?: string; deletedAt?: Date | null },
) {
  const [row] = await db
    .update(agentIdentities)
    .set(patch)
    .where(eq(agentIdentities.id, id))
    .returning();
  return row;
}
