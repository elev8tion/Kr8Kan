import { describe, expect, it, vi } from "vitest";

import { BrowserConfirmChannel } from "../browserConfirm";

const ctx = { jobId: "job1", workspaceId: 1 };

function req(id = "r1") {
  return {
    requestId: id,
    summary: "press Enter",
    url: "https://example.com/",
    ruleName: "Form submission",
    reason: 'Action matches safety rule "Form submission"',
  };
}

describe("BrowserConfirmChannel", () => {
  it("resolves true when a human approves", async () => {
    const channel = new BrowserConfirmChannel();
    const pending = channel.request(ctx, req());
    expect(channel.size()).toBe(1);
    expect(channel.respond("r1", true)).toEqual({
      approved: true,
      matched: true,
    });
    await expect(pending).resolves.toBe(true);
    expect(channel.size()).toBe(0);
  });

  it("resolves false when a human denies", async () => {
    const channel = new BrowserConfirmChannel();
    const pending = channel.request(ctx, req());
    channel.respond("r1", false);
    await expect(pending).resolves.toBe(false);
  });

  it("denies on timeout rather than hanging or approving", async () => {
    vi.useFakeTimers();
    try {
      const channel = new BrowserConfirmChannel({ timeoutMs: 1000 });
      const pending = channel.request(ctx, req());
      vi.advanceTimersByTime(1001);
      await expect(pending).resolves.toBe(false);
      expect(channel.size()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a second answer for the same request", async () => {
    const channel = new BrowserConfirmChannel();
    const pending = channel.request(ctx, req());
    channel.respond("r1", false);
    // A late "approve" must not un-deny an action already denied.
    expect(channel.respond("r1", true)).toEqual({
      approved: false,
      matched: false,
    });
    await expect(pending).resolves.toBe(false);
  });

  it("reports an unknown request id instead of approving it", () => {
    const channel = new BrowserConfirmChannel();
    expect(channel.respond("nope", true)).toEqual({
      approved: false,
      matched: false,
    });
  });

  it("denies a duplicate request id rather than shadowing the first", async () => {
    const channel = new BrowserConfirmChannel();
    const first = channel.request(ctx, req());
    const second = channel.request(ctx, req());
    await expect(second).resolves.toBe(false);
    expect(channel.size()).toBe(1);
    channel.respond("r1", true);
    await expect(first).resolves.toBe(true);
  });

  it("denies everything still parked on shutdown", async () => {
    const channel = new BrowserConfirmChannel();
    const a = channel.request(ctx, req("a"));
    const b = channel.request(ctx, req("b"));
    expect(channel.denyAll()).toBe(2);
    await expect(a).resolves.toBe(false);
    await expect(b).resolves.toBe(false);
  });

  it("denies only the named job when a job dies", async () => {
    const channel = new BrowserConfirmChannel();
    const mine = channel.request(ctx, req("a"));
    const other = channel.request({ jobId: "job2", workspaceId: 1 }, req("b"));
    expect(channel.denyAll({ jobId: "job1" })).toBe(1);
    await expect(mine).resolves.toBe(false);
    expect(channel.size()).toBe(1);
    channel.respond("b", true);
    await expect(other).resolves.toBe(true);
  });

  it("scopes listing to a workspace", () => {
    const channel = new BrowserConfirmChannel();
    void channel.request(ctx, req("a"));
    void channel.request({ jobId: "job9", workspaceId: 2 }, req("b"));
    const listed = channel.list({ workspaceId: 1 });
    expect(listed.map((p) => p.requestId)).toEqual(["a"]);
    expect(listed[0]?.ruleName).toBe("Form submission");
  });

  it("filters a listing by job", () => {
    const channel = new BrowserConfirmChannel();
    void channel.request(ctx, req("a"));
    void channel.request({ jobId: "job2", workspaceId: 1 }, req("b"));
    expect(
      channel.list({ workspaceId: 1, jobId: "job2" }).map((p) => p.requestId),
    ).toEqual(["b"]);
  });

  it("never leaks the resolver through the listing", () => {
    const channel = new BrowserConfirmChannel();
    void channel.request(ctx, req());
    const listed = channel.list({ workspaceId: 1 })[0] as
      Record<string, unknown> | undefined;
    expect(listed).toBeDefined();
    expect(listed?.settle).toBeUndefined();
    expect(listed?.timer).toBeUndefined();
  });

  it("publishes when a request expires", () => {
    const channel = new BrowserConfirmChannel({
      timeoutMs: 60_000,
      now: () => new Date("2026-07-26T00:00:00.000Z"),
    });
    void channel.request(ctx, req());
    expect(channel.get("r1")?.expiresAt).toBe("2026-07-26T00:01:00.000Z");
  });
});
