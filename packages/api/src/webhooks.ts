import { createLogger } from "@kr8kan/logger";
import type { Database } from "@kr8kan/db";
import { webhookRepo } from "@kr8kan/db";

const logger = createLogger("webhooks");

/**
 * Workspace webhooks: fire-and-forget POSTs to operator-configured local
 * or remote URLs on card events. This is the notification surface —
 * no Novu, no cloud notification product.
 */

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
      await Promise.allSettled(
        matching.map((hook) =>
          fetch(hook.url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: rawBody,
            signal: AbortSignal.timeout(5000),
          }),
        ),
      );
    } catch (err) {
      logger.warn({ err, event }, "webhook dispatch failed");
    }
  })();
}
