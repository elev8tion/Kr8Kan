import { createLogger } from "@kr8kan/logger";
import type { Database } from "@kr8kan/db";
import { webhookRepo } from "@kr8kan/db";

const logger = createLogger("webhooks");

/**
 * Workspace webhooks: fire-and-forget POSTs to operator-configured local
 * or remote URLs on card events. This is the notification surface —
 * no Novu, no cloud notification product.
 *
 * Slack incoming-webhook URLs (hooks.slack.com) are detected by host and
 * receive Block Kit payloads automatically; every other URL gets the raw
 * JSON exactly as before.
 */

const EVENT_HEADINGS: Record<string, string> = {
  "card.created": "🃏 Card created",
  "card.moved": "📦 Card moved",
  "workflow.gate.pending": "🚪 Approval needed",
};

function humanizeEvent(event: string): string {
  return EVENT_HEADINGS[event] ?? `🔔 ${event}`;
}

export function isSlackWebhookUrl(url: string): boolean {
  try {
    return new URL(url).hostname === "hooks.slack.com";
  } catch {
    return false;
  }
}

interface NamedRef {
  publicId?: string;
  name?: string;
  title?: string;
}

/**
 * Transform a Kr8Kan webhook payload into Slack Block Kit. Pure function,
 * exported for tests. Links are emitted only when a base URL is
 * configured (NEXT_PUBLIC_BASE_URL).
 */
export function toSlackPayload(
  event: string,
  payload: Record<string, unknown>,
  baseUrl?: string,
): Record<string, unknown> {
  const card = payload.card as NamedRef | undefined;
  const board = payload.board as NamedRef | undefined;
  const list = payload.list as NamedRef | undefined;
  const toList = payload.toList as NamedRef | undefined;
  const workflow = payload.workflow as NamedRef | undefined;
  const run = payload.run as NamedRef | undefined;

  const fields: string[] = [];
  if (card?.title) fields.push(`*Card:* ${card.title}`);
  if (workflow?.name) fields.push(`*Workflow:* ${workflow.name}`);
  if (board?.name) fields.push(`*Board:* ${board.name}`);
  if (list?.name) fields.push(`*List:* ${list.name}`);
  if (toList?.name) fields.push(`*Moved to:* ${toList.name}`);
  if (run?.publicId) fields.push(`*Run:* \`${run.publicId}\``);

  const boardId = board?.publicId;
  const cardId = card?.publicId;
  if (baseUrl && boardId && cardId) {
    fields.push(`<${baseUrl}/boards/${boardId}?card=${cardId}|Open card in Kr8Kan>`);
  } else if (baseUrl && boardId) {
    fields.push(`<${baseUrl}/boards/${boardId}|Open board in Kr8Kan>`);
  }

  const blocks: Record<string, unknown>[] = [
    {
      type: "header",
      text: { type: "plain_text", text: humanizeEvent(event), emoji: true },
    },
  ];
  if (fields.length > 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: fields.join("\n") },
    });
  }
  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: `Kr8Kan · ${event}` }],
  });

  return { text: humanizeEvent(event), blocks };
}

export function dispatchWebhookEvent(
  db: Database,
  workspaceId: number,
  event: string,
  payload: Record<string, unknown>,
): void {
  void (async () => {
    try {
      const hooks = await webhookRepo.listWebhooks(db, workspaceId);
      const matching = hooks.filter(
        (h) =>
          h.enabled &&
          (h.events.length === 0 ||
            h.events.includes(event) ||
            h.events.includes("*")),
      );
      const rawBody = JSON.stringify({
        event,
        timestamp: new Date().toISOString(),
        ...payload,
      });
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;
      await Promise.allSettled(
        matching.map((hook) =>
          fetch(hook.url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: isSlackWebhookUrl(hook.url)
              ? JSON.stringify(toSlackPayload(event, payload, baseUrl))
              : rawBody,
            signal: AbortSignal.timeout(5000),
          }),
        ),
      );
    } catch (err) {
      logger.warn({ err, event }, "webhook dispatch failed");
    }
  })();
}
