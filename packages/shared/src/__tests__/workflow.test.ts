import { describe, expect, it } from "vitest";

import { cronDueBetween, cronMatches, isValidCron, parseCron } from "../cron";
import { interpolate } from "../interpolate";
import { matchesTrigger, workflowStepsSchema } from "../workflow";

describe("cron parser", () => {
  it("parses and matches simple expressions", () => {
    const expr = parseCron("0 9 * * 1");
    expect(cronMatches(expr, new Date("2026-07-20T09:00:00"))).toBe(true); // Monday
    expect(cronMatches(expr, new Date("2026-07-21T09:00:00"))).toBe(false); // Tuesday
    expect(cronMatches(expr, new Date("2026-07-20T10:00:00"))).toBe(false);
  });

  it("supports steps, ranges, and lists", () => {
    const expr = parseCron("*/15 8-17 * * 1-5");
    expect(cronMatches(expr, new Date("2026-07-22T08:30:00"))).toBe(true);
    expect(cronMatches(expr, new Date("2026-07-22T08:07:00"))).toBe(false);
    expect(cronMatches(expr, new Date("2026-07-25T08:30:00"))).toBe(false); // Saturday
  });

  it("cronDueBetween catches a schedule inside the window", () => {
    const expr = parseCron("0 9 * * *");
    expect(
      cronDueBetween(
        expr,
        new Date("2026-07-22T08:41:00"),
        new Date("2026-07-22T09:41:00"),
      ),
    ).toBe(true);
    expect(
      cronDueBetween(
        expr,
        new Date("2026-07-22T09:41:00"),
        new Date("2026-07-22T10:41:00"),
      ),
    ).toBe(false);
  });

  it("rejects malformed expressions", () => {
    expect(isValidCron("0 9 * *")).toBe(false);
    expect(isValidCron("99 9 * * *")).toBe(false);
    expect(isValidCron("not a cron")).toBe(false);
    expect(isValidCron("0 9 * * 1")).toBe(true);
  });
});

describe("interpolate", () => {
  const scope = {
    card: { title: "Fix login", publicId: "abc123def456" },
    steps: [{ result: { summary: "done" } }],
    secret: "leak-me",
  };

  it("resolves whitelisted paths", () => {
    expect(interpolate("Card: {{card.title}}", scope)).toBe("Card: Fix login");
    expect(interpolate("{{steps.0.result.summary}}", scope)).toBe("done");
    expect(interpolate("{{steps[0].result.summary}}", scope)).toBe("done");
  });

  it("unknown and non-whitelisted roots render empty", () => {
    expect(interpolate("{{secret}}", scope)).toBe("");
    expect(interpolate("{{card.missing}}", scope)).toBe("");
    expect(interpolate("{{process.env.HOME}}", scope)).toBe("");
  });
});

describe("workflow trigger matching", () => {
  it("matches card.created with optional list filter", () => {
    const event = {
      type: "card.created" as const,
      workspaceId: 1,
      listPublicId: "lst111111111",
    };
    expect(matchesTrigger({ type: "card.created" }, event)).toBe(true);
    expect(
      matchesTrigger({ type: "card.created", listPublicId: "lst111111111" }, event),
    ).toBe(true);
    expect(
      matchesTrigger({ type: "card.created", listPublicId: "lst222222222" }, event),
    ).toBe(false);
  });

  it("reaction trigger matches emoji + agent-comment filter", () => {
    const base = { type: "reaction.added" as const, workspaceId: 1, emoji: "👍" };
    expect(matchesTrigger({ type: "reaction.added", emoji: "👍" }, base)).toBe(true);
    expect(
      matchesTrigger(
        { type: "reaction.added", emoji: "👍", onAgentComment: true },
        { ...base, commentIsAgent: false },
      ),
    ).toBe(false);
  });

  it("applyPreset without a preceding gate is rejected", () => {
    const bad = workflowStepsSchema.safeParse([
      { type: "runWorker", worker: "triage-card" },
      { type: "applyPreset", autoApply: false },
    ]);
    expect(bad.success).toBe(false);
    const good = workflowStepsSchema.safeParse([
      { type: "runWorker", worker: "triage-card" },
      { type: "gate", emoji: "👍", approvers: "member", timeoutHours: 24 },
      { type: "applyPreset", autoApply: false },
    ]);
    expect(good.success).toBe(true);
  });

  it("applyPreset with explicit autoApply passes without a gate", () => {
    const parsed = workflowStepsSchema.safeParse([
      { type: "runWorker", worker: "standup" },
      { type: "applyPreset", autoApply: true },
    ]);
    expect(parsed.success).toBe(true);
  });
});
