import { generateUID } from "@kr8kan/shared";

import type { Database } from "../client";
import type { agentIdentities, boardNotes, user } from "../schema";

export type BoardNoteRow = typeof boardNotes.$inferSelect;
type UserRow = typeof user.$inferSelect;
type AgentIdentityRow = typeof agentIdentities.$inferSelect;

export async function getNote(db: Database, boardId: number) {
  const note = (await db.findFirst("boardNotes", { where: { boardId } })) as
    | BoardNoteRow
    | undefined;
  if (!note) return undefined;
  const author = note.updatedBy
    ? ((await db.findFirst("user", { where: { id: note.updatedBy } })) as
        | UserRow
        | undefined)
    : undefined;
  const agent = note.updatedByAgentId
    ? ((await db.findFirst("agentIdentities", {
        where: { id: note.updatedByAgentId },
        includeDeleted: true,
      })) as AgentIdentityRow | undefined)
    : undefined;
  return {
    ...note,
    author: (author ?? null) as UserRow | null,
    agent: (agent ?? null) as AgentIdentityRow | null,
  };
}

/** One note per board — insert on first write, update thereafter. */
export async function upsertNote(
  db: Database,
  input: {
    boardId: number;
    content: string;
    userId: string;
    agentIdentityId?: number | null;
  },
) {
  const existing = (await db.findFirst("boardNotes", {
    where: { boardId: input.boardId },
  })) as BoardNoteRow | undefined;
  if (existing) {
    return (await db.update("boardNotes", existing.id, {
      content: input.content,
      updatedBy: input.userId,
      updatedByAgentId: input.agentIdentityId ?? null,
      updatedAt: new Date(),
    })) as BoardNoteRow | undefined;
  }
  return (await db.insert("boardNotes", {
    publicId: generateUID(),
    boardId: input.boardId,
    content: input.content,
    updatedBy: input.userId,
    updatedByAgentId: input.agentIdentityId ?? null,
  })) as BoardNoteRow;
}
