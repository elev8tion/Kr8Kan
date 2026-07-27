import { generateUID } from "@kr8kan/shared";

import type { Database } from "../client";
import type { cardTemplates, user } from "../schema";

export type CardTemplateRow = typeof cardTemplates.$inferSelect;

type UserRow = typeof user.$inferSelect;

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
  return (await db.insert("cardTemplates", {
    publicId: generateUID(),
    ...input,
    // Postgres column defaults ([]) no longer apply — keep the notNull shape.
    checklist: input.checklist ?? [],
    labels: input.labels ?? [],
  })) as CardTemplateRow | undefined;
}

export async function listTemplates(db: Database, workspaceId: number) {
  const rows = (await db.findMany("cardTemplates", {
    where: { workspaceId },
    orderBy: { field: "createdAt", dir: "desc" },
  })) as CardTemplateRow[];
  const users = (await db.findMany("user")) as UserRow[];
  const usersById = new Map(users.map((u) => [u.id, u]));
  return rows.map((t) => ({
    ...t,
    author: t.createdBy ? (usersById.get(t.createdBy) ?? null) : null,
  }));
}

export async function getTemplateByPublicId(db: Database, publicId: string) {
  return (await db.findFirst("cardTemplates", { where: { publicId } })) as
    | CardTemplateRow
    | undefined;
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
  return (await db.update("cardTemplates", id, {
    ...patch,
    updatedAt: new Date(),
  })) as CardTemplateRow | undefined;
}

export async function softDeleteTemplate(db: Database, id: number) {
  await updateTemplate(db, id, { deletedAt: new Date() });
}
