import { generateUID } from "@kr8kan/shared";

import type { Database } from "../client";
import type { webhooks } from "../schema";

type WebhookRow = typeof webhooks.$inferSelect;

export async function listWebhooks(db: Database, workspaceId: number) {
  return (await db.findMany("webhooks", {
    where: { workspaceId },
    orderBy: { field: "createdAt" },
  })) as WebhookRow[];
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
  return (await db.insert("webhooks", {
    publicId: generateUID(),
    signingSecret: generateUID(48),
    ...input,
  })) as WebhookRow;
}

export async function getWebhookByPublicId(db: Database, publicId: string) {
  return (await db.findFirst("webhooks", { where: { publicId } })) as
    | WebhookRow
    | undefined;
}

export async function updateWebhook(
  db: Database,
  webhookId: number,
  input: { url?: string; events?: string[]; enabled?: boolean },
) {
  return (await db.update("webhooks", webhookId, input)) as
    | WebhookRow
    | undefined;
}

export async function softDeleteWebhook(db: Database, webhookId: number) {
  await db.update("webhooks", webhookId, { deletedAt: new Date() });
}

/**
 * Generates a new signing secret and stores it, invalidating the previous
 * one. The caller is responsible for returning the plaintext secret to the
 * operator exactly once — it is never re-readable after this call returns.
 */
export async function rotateWebhookSecret(db: Database, webhookId: number) {
  const signingSecret = generateUID(48);
  const row = (await db.update("webhooks", webhookId, {
    signingSecret,
  })) as WebhookRow | undefined;
  return row;
}
