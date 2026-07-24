import { and, desc, eq, isNull } from "drizzle-orm";

import { generateUID } from "@kr8kan/shared";

import type { Database } from "../client";
import { cardTemplates } from "../schema";

export type CardTemplateRow = typeof cardTemplates.$inferSelect;

export async function createTemplate(
  db: Database,
  input: {
    workspaceId: number;
    name: string;
    title: string;
    description?: string | null;
    checklist?: string[];
    labels?: string[];
    createdBy: string;
  },
) {
  const [row] = await db
    .insert(cardTemplates)
    .values({ publicId: generateUID(), ...input })
    .returning();
  return row;
}

export async function listTemplates(db: Database, workspaceId: number) {
  return db.query.cardTemplates.findMany({
    where: and(
      eq(cardTemplates.workspaceId, workspaceId),
      isNull(cardTemplates.deletedAt),
    ),
    orderBy: desc(cardTemplates.createdAt),
    with: { author: true },
  });
}

export async function getTemplateByPublicId(db: Database, publicId: string) {
  return db.query.cardTemplates.findFirst({
    where: and(
      eq(cardTemplates.publicId, publicId),
      isNull(cardTemplates.deletedAt),
    ),
  });
}

export async function updateTemplate(
  db: Database,
  id: number,
  patch: Partial<{
    name: string;
    title: string;
    description: string | null;
    checklist: string[];
    labels: string[];
    deletedAt: Date;
  }>,
) {
  const [row] = await db
    .update(cardTemplates)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(cardTemplates.id, id))
    .returning();
  return row;
}

export async function softDeleteTemplate(db: Database, id: number) {
  await updateTemplate(db, id, { deletedAt: new Date() });
}
