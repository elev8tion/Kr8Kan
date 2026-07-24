import { eq } from "drizzle-orm";

import { generateUID } from "@kr8kan/shared";

import type { Database } from "../client";
import { boardNotes } from "../schema";

export type BoardNoteRow = typeof boardNotes.$inferSelect;

export async function getNote(db: Database, boardId: number) {
  return db.query.boardNotes.findFirst({
    where: eq(boardNotes.boardId, boardId),
    with: { author: true, agent: true },
  });
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
  const existing = await db.query.boardNotes.findFirst({
    where: eq(boardNotes.boardId, input.boardId),
    columns: { id: true },
  });
  if (existing) {
    const [row] = await db
      .update(boardNotes)
      .set({
        content: input.content,
        updatedBy: input.userId,
        updatedByAgentId: input.agentIdentityId ?? null,
        updatedAt: new Date(),
      })
      .where(eq(boardNotes.id, existing.id))
      .returning();
    return row;
  }
  const [row] = await db
    .insert(boardNotes)
    .values({
      publicId: generateUID(),
      boardId: input.boardId,
      content: input.content,
      updatedBy: input.userId,
      updatedByAgentId: input.agentIdentityId ?? null,
    })
    .returning();
  return row;
}
