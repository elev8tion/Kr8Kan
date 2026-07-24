import { and, asc, eq, isNull } from "drizzle-orm";

import { generateUID } from "@kr8kan/shared";

import type { Database } from "../client";
import { webhooks } from "../schema";

export async function listWebhooks(db: Database, workspaceId: number) {
  return db.query.webhooks.findMany({
    where: and(eq(webhooks.workspaceId, workspaceId), isNull(webhooks.deletedAt)),
    orderBy: asc(webhooks.createdAt),
  });
}

export async function createWebhook(
  db: Database,
  input: {
    workspaceId: number;
    url: string;
    events: string[];
    createdBy: string;
  },
) {
  const [webhook] = await db
    .insert(webhooks)
    .values({ publicId: generateUID(), ...input })
    .returning();
  return webhook;
}

export async function getWebhookByPublicId(db: Database, publicId: string) {
  return db.query.webhooks.findFirst({
    where: and(eq(webhooks.publicId, publicId), isNull(webhooks.deletedAt)),
  });
}

export async function updateWebhook(
  db: Database,
  webhookId: number,
  input: { url?: string; events?: string[]; enabled?: boolean },
) {
  const [updated] = await db
    .update(webhooks)
    .set(input)
    .where(eq(webhooks.id, webhookId))
    .returning();
  return updated;
}

export async function softDeleteWebhook(db: Database, webhookId: number) {
  await db
    .update(webhooks)
    .set({ deletedAt: new Date() })
    .where(eq(webhooks.id, webhookId));
}
