import { and, eq, isNull } from "drizzle-orm";

import { generateUID } from "@kr8kan/shared";

import type { Database } from "../client";
import { customWorkers } from "../schema";

export type CustomWorkerRow = typeof customWorkers.$inferSelect;

export async function createCustomWorker(
  db: Database,
  input: {
    workspaceId: number;
    name: string;
    title: string;
    description?: string | null;
    avatar?: string;
    systemPrompt: string;
    needs?: string;
    outputMode?: string;
    schemaWorker?: string | null;
    createdBy: string;
  },
) {
  const [row] = await db
    .insert(customWorkers)
    .values({ publicId: generateUID(), ...input })
    .returning();
  return row;
}

export async function updateCustomWorker(
  db: Database,
  id: number,
  patch: Partial<{
    title: string;
    description: string | null;
    avatar: string;
    systemPrompt: string;
    needs: string;
    outputMode: string;
    schemaWorker: string | null;
    promptVersion: number;
    deletedAt: Date;
  }>,
) {
  const [row] = await db
    .update(customWorkers)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(customWorkers.id, id))
    .returning();
  return row;
}

export async function getCustomWorkerByName(
  db: Database,
  workspaceId: number,
  name: string,
) {
  return db.query.customWorkers.findFirst({
    where: and(
      eq(customWorkers.workspaceId, workspaceId),
      eq(customWorkers.name, name),
      isNull(customWorkers.deletedAt),
    ),
  });
}

export async function getCustomWorkerByPublicId(db: Database, publicId: string) {
  return db.query.customWorkers.findFirst({
    where: and(
      eq(customWorkers.publicId, publicId),
      isNull(customWorkers.deletedAt),
    ),
  });
}

export async function listCustomWorkers(db: Database, workspaceId: number) {
  return db.query.customWorkers.findMany({
    where: and(
      eq(customWorkers.workspaceId, workspaceId),
      isNull(customWorkers.deletedAt),
    ),
  });
}
