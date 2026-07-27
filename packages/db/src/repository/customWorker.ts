import { generateUID } from "@kr8kan/shared";

import type { Database } from "../client";
import type { customWorkers } from "../schema";

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
  return (await db.insert("customWorkers", {
    publicId: generateUID(),
    ...input,
  })) as CustomWorkerRow;
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
  return (await db.update("customWorkers", id, {
    ...patch,
    updatedAt: new Date(),
  })) as CustomWorkerRow | undefined;
}

export async function getCustomWorkerByName(
  db: Database,
  workspaceId: number,
  name: string,
) {
  return (await db.findFirst("customWorkers", {
    where: { workspaceId, name },
  })) as CustomWorkerRow | undefined;
}

export async function getCustomWorkerByPublicId(db: Database, publicId: string) {
  return (await db.findFirst("customWorkers", {
    where: { publicId },
  })) as CustomWorkerRow | undefined;
}

export async function listCustomWorkers(db: Database, workspaceId: number) {
  return (await db.findMany("customWorkers", {
    where: { workspaceId },
  })) as CustomWorkerRow[];
}
