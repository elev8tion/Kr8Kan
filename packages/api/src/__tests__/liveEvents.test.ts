import { describe, expect, it } from "vitest";

/**
 * Wave D live-event pub/sub: subscribe/publish/unsubscribe lifecycle,
 * the per-workspace subscriber cap (refusal, not oldest-dropped), and
 * subscriber-isolation guarantees (a throwing subscriber breaks nothing).
 */

import type { LiveEvent } from "../liveEvents";
import {
  MAX_LIVE_SUBSCRIBERS,
  liveSubscriberCount,
  publishLive,
  subscribeLive,
} from "../liveEvents";

const WS = 424242; // isolated workspace ids per test to avoid cross-talk

describe("live event pub/sub", () => {
  it("delivers published events to subscribers of the same workspace only", () => {
    const got: LiveEvent[] = [];
    const other: LiveEvent[] = [];
    const un1 = subscribeLive(WS, (e) => got.push(e));
    const un2 = subscribeLive(WS + 1, (e) => other.push(e));
    publishLive(WS, { type: "message.posted", channelPublicId: "chan00000001" });
    expect(got).toHaveLength(1);
    expect(got[0]?.channelPublicId).toBe("chan00000001");
    expect(other).toHaveLength(0);
    un1?.();
    un2?.();
  });

  it("unsubscribe stops delivery and empties the workspace slot", () => {
    const got: LiveEvent[] = [];
    const un = subscribeLive(WS + 2, (e) => got.push(e));
    expect(liveSubscriberCount(WS + 2)).toBe(1);
    un?.();
    expect(liveSubscriberCount(WS + 2)).toBe(0);
    publishLive(WS + 2, {
      type: "message.deleted",
      channelPublicId: "chan00000001",
    });
    expect(got).toHaveLength(0);
  });

  it("publishing to a workspace with no subscribers is a no-op", () => {
    expect(() =>
      publishLive(WS + 3, {
        type: "message.edited",
        channelPublicId: "chan00000001",
      }),
    ).not.toThrow();
  });

  it("refuses subscribers over the cap; frees a slot on unsubscribe", () => {
    const ws = WS + 4;
    const subs = Array.from({ length: MAX_LIVE_SUBSCRIBERS }, () =>
      subscribeLive(ws, () => undefined),
    );
    expect(subs.every(Boolean)).toBe(true);
    expect(liveSubscriberCount(ws)).toBe(MAX_LIVE_SUBSCRIBERS);
    expect(subscribeLive(ws, () => undefined)).toBeNull();
    subs[0]?.();
    const replacement = subscribeLive(ws, () => undefined);
    expect(replacement).not.toBeNull();
    replacement?.();
    subs.slice(1).forEach((un) => un?.());
    expect(liveSubscriberCount(ws)).toBe(0);
  });

  it("a throwing subscriber does not break the publisher or its siblings", () => {
    const ws = WS + 5;
    const got: LiveEvent[] = [];
    const unBad = subscribeLive(ws, () => {
      throw new Error("subscriber bug");
    });
    const unGood = subscribeLive(ws, (e) => got.push(e));
    expect(() =>
      publishLive(ws, {
        type: "message.reaction",
        channelPublicId: "chan00000001",
        messagePublicId: "mesg00000001",
      }),
    ).not.toThrow();
    expect(got).toHaveLength(1);
    unBad?.();
    unGood?.();
  });

  it("double-unsubscribe is idempotent", () => {
    const ws = WS + 6;
    const un = subscribeLive(ws, () => undefined);
    un?.();
    expect(() => un?.()).not.toThrow();
    expect(liveSubscriberCount(ws)).toBe(0);
  });
});
