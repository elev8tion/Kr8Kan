import { createHmac } from "node:crypto";

import { createLogger } from "@kr8kan/logger";
import type { Database } from "@kr8kan/db";
import { webhookRepo } from "@kr8kan/db";

const logger = createLogger("webhooks");

/**
 * Workspace webhooks: fire-and-forget POSTs to operator-configured local
 * or remote URLs on card events. This is the notification surface —
 * no Novu, no cloud notification product.
 */

/**
 * Signs a delivery, Stripe-style: HMAC-SHA256 over `${timestamp}.${rawBody}`
 * using the webhook's signing secret, where `timestamp` is unix seconds.
 * Binding the timestamp into the signed material (rather than signing the
 * body alone) stops a captured request from being replayed later.
 *
 * Verification recipe for receivers:
 *   1. Read `X-Kr8kan-Timestamp` and `X-Kr8kan-Signature` (format
 *      `sha256=<hex>`) from the request headers.
 *   2. Recompute `hmac_sha256(secret, `${timestamp}.${rawBody}`)` over the
 *      exact raw request body bytes (before any JSON parsing).
 *   3. Compare hex digests using a constant-time comparison
 *      (e.g. `crypto.timingSafeEqual`).
 *   4. Reject if `|now - timestamp| > 300` seconds to bound replay window.
 */
function signPayload(
  secret: string,
  timestamp: number,
  rawBody: string,
): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
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
      const timestamp = Math.floor(Date.now() / 1000);
      await Promise.allSettled(
        matching.map((hook) => {
          const headers: Record<string, string> = {
            "content-type": "application/json",
            "X-Kr8kan-Event": event,
            "X-Kr8kan-Timestamp": String(timestamp),
          };
          // Legacy rows created before signing was added have no secret —
          // those deliveries still go out, just unsigned.
          if (hook.signingSecret) {
            const digest = signPayload(hook.signingSecret, timestamp, rawBody);
            headers["X-Kr8kan-Signature"] = `sha256=${digest}`;
          }
          return fetch(hook.url, {
            method: "POST",
            headers,
            body: rawBody,
            signal: AbortSignal.timeout(5000),
          });
        }),
      );
    } catch (err) {
      logger.warn({ err, event }, "webhook dispatch failed");
    }
  })();
}
