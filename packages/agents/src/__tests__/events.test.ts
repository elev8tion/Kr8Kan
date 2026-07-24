import { describe, expect, it } from "vitest";

import {
  EVENT_DETAIL_MAX,
  EVENT_RING_MAX,
  FAILURE_CONTEXT_MAX,
  buildFailureContext,
  pushEvent,
} from "../events";
import type { JobEvent } from "../types";

describe("pushEvent ring bounding", () => {
  it("keeps at most EVENT_RING_MAX events, dropping the oldest", () => {
    const ring: JobEvent[] = [];
    for (let i = 0; i < EVENT_RING_MAX + 50; i++) {
      pushEvent(ring, `event-${i}`);
    }
    expect(ring).toHaveLength(EVENT_RING_MAX);
    expect(ring[0]!.type).toBe("event-50");
    expect(ring.at(-1)!.type).toBe(`event-${EVENT_RING_MAX + 49}`);
  });

  it("truncates oversized detail with a marker", () => {
    const ring: JobEvent[] = [];
    pushEvent(ring, "big", "x".repeat(EVENT_DETAIL_MAX * 2));
    expect(ring[0]!.detail!.length).toBeLessThanOrEqual(EVENT_DETAIL_MAX + 20);
    expect(ring[0]!.detail).toContain("…[truncated]");
  });

  it("keeps short detail intact and stamps a timestamp", () => {
    const ring: JobEvent[] = [];
    pushEvent(ring, "tool_execution_start", "read");
    expect(ring[0]).toMatchObject({ type: "tool_execution_start", detail: "read" });
    expect(Date.parse(ring[0]!.at)).not.toBeNaN();
  });

  it("ignores empty types and never throws", () => {
    const ring: JobEvent[] = [];
    expect(() => pushEvent(ring, "")).not.toThrow();
    expect(ring).toHaveLength(0);
  });
});

describe("buildFailureContext", () => {
  const base = {
    id: "job123",
    worker: "dev-task",
    status: "failed" as const,
  };

  it("returns null for a successful prior job", () => {
    expect(
      buildFailureContext({ ...base, status: "completed" }),
    ).toBeNull();
  });

  it("builds a delimited block with error, verify tail and event slice", () => {
    const block = buildFailureContext({
      ...base,
      error: "typecheck exploded",
      verifyStatus: "fail",
      verifyLog: "$ pnpm test\n3 tests failed",
      events: [
        { at: "2026-07-24T10:00:00.000Z", type: "worker.spawned" },
        { at: "2026-07-24T10:00:05.000Z", type: "tool_execution_start", detail: "bash" },
      ],
    });
    expect(block).toContain("## Previous attempt failed");
    expect(block).toContain("job job123");
    expect(block).toContain("typecheck exploded");
    expect(block).toContain("3 tests failed");
    expect(block).toContain("tool_execution_start: bash");
  });

  it("treats a completed job with a failed verify as retryable", () => {
    const block = buildFailureContext({
      ...base,
      status: "completed",
      verifyStatus: "fail",
      verifyLog: "lint failed",
    });
    expect(block).toContain("verify: fail");
    expect(block).toContain("lint failed");
  });

  it("caps the whole block and takes only the verify log tail", () => {
    const block = buildFailureContext({
      ...base,
      error: "e".repeat(50_000),
      verifyLog: `HEAD-MARKER${"v".repeat(50_000)}TAIL-MARKER`,
      events: Array.from({ length: 200 }, (_, i) => ({
        at: "2026-07-24T10:00:00.000Z",
        type: `event-${i}`,
        detail: "d".repeat(1000),
      })),
    });
    expect(block!.length).toBeLessThanOrEqual(FAILURE_CONTEXT_MAX + 20);
    expect(block).toContain("…[truncated]");
    // tail slice, not head: the marker at the front must be gone
    expect(block).not.toContain("HEAD-MARKER");
  });

  it("diagnose mode swaps the header and instruction, retry stays default", () => {
    const failed = { ...base, error: "boom" };
    const retry = buildFailureContext(failed);
    expect(retry).toContain("## Previous attempt failed");
    expect(retry).toContain("do not repeat the same mistake");
    const diagnose = buildFailureContext(failed, { purpose: "diagnose" });
    expect(diagnose).toContain("## Failed job under investigation");
    expect(diagnose).toContain("identify the probable cause");
    expect(diagnose).not.toContain("## Previous attempt failed");
    // successful jobs stay null in both modes
    expect(
      buildFailureContext({ ...base, status: "completed" }, { purpose: "diagnose" }),
    ).toBeNull();
  });

  it("only includes the last 15 events", () => {
    const block = buildFailureContext({
      ...base,
      events: Array.from({ length: 40 }, (_, i) => ({
        at: "2026-07-24T10:00:00.000Z",
        type: `event-${i}`,
      })),
    });
    expect(block).toContain("last 15 of 40");
    expect(block).toContain("event-39");
    expect(block).not.toContain("2026-07-24T10:00:00.000Z event-24\n");
  });
});
