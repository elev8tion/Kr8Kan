import { describe, expect, it } from "vitest";

import { cronDueBetween, cronMatches, isValidCron, parseCron } from "../cron";
import { interpolate } from "../interpolate";
import {
  isSystemEventTrigger,
  matchesTrigger,
  workflowStepsSchema,
  workflowTriggerSchema,
} from "../workflow";

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

  it("reaction trigger fires for message reactions with the same semantics", () => {
    // Channel surface: commentIsAgent maps to "the reacted-to message was
    // agent-authored". No loop risk — no workflow step adds reactions.
    const onMessage = {
      type: "reaction.added" as const,
      workspaceId: 1,
      emoji: "👍",
      channelPublicId: "chn111111111",
      messagePublicId: "msg111111111",
      commentIsAgent: true,
    };
    expect(matchesTrigger({ type: "reaction.added", emoji: "👍" }, onMessage)).toBe(
      true,
    );
    expect(
      matchesTrigger(
        { type: "reaction.added", emoji: "👍", onAgentComment: true },
        onMessage,
      ),
    ).toBe(true);
    expect(
      matchesTrigger(
        { type: "reaction.added", emoji: "🚀", onAgentComment: true },
        onMessage,
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

  it("postComment accepts an optional 12-char target card", () => {
    expect(
      workflowStepsSchema.safeParse([
        {
          type: "postComment",
          bodyTemplate: "hi",
          targetCardPublicId: "crd111111111",
        },
      ]).success,
    ).toBe(true);
    expect(
      workflowStepsSchema.safeParse([
        { type: "postComment", bodyTemplate: "hi", targetCardPublicId: "short" },
      ]).success,
    ).toBe(false);
    expect(
      workflowStepsSchema.safeParse([
        { type: "postComment", bodyTemplate: "hi" },
      ]).success,
    ).toBe(true);
  });

  it("postNote validates body and mode, defaults to append", () => {
    const parsed = workflowStepsSchema.safeParse([
      { type: "postNote", bodyTemplate: "## Digest\n{{steps.0.result.summary}}" },
    ]);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data[0]).toMatchObject({ type: "postNote", mode: "append" });
    }
    expect(
      workflowStepsSchema.safeParse([
        { type: "postNote", bodyTemplate: "x", mode: "replace" },
      ]).success,
    ).toBe(true);
    expect(
      workflowStepsSchema.safeParse([
        { type: "postNote", bodyTemplate: "" },
      ]).success,
    ).toBe(false);
    expect(
      workflowStepsSchema.safeParse([
        { type: "postNote", bodyTemplate: "x", mode: "prepend" },
      ]).success,
    ).toBe(false);
  });

  it("system-event triggers parse, with an optional worker filter on job events", () => {
    expect(workflowTriggerSchema.safeParse({ type: "job.failed" }).success).toBe(true);
    expect(
      workflowTriggerSchema.safeParse({ type: "job.failed", worker: "dev-task" })
        .success,
    ).toBe(true);
    expect(
      workflowTriggerSchema.safeParse({ type: "job.verify_failed" }).success,
    ).toBe(true);
    expect(
      workflowTriggerSchema.safeParse({ type: "workflow.run.failed" }).success,
    ).toBe(true);
    expect(
      workflowTriggerSchema.safeParse({ type: "job.failed", worker: "" }).success,
    ).toBe(false);
  });

  it("job.failed matches on the optional worker filter", () => {
    const event = {
      type: "job.failed" as const,
      workspaceId: 1,
      jobId: "job1",
      worker: "standup",
    };
    expect(matchesTrigger({ type: "job.failed" }, event)).toBe(true);
    expect(matchesTrigger({ type: "job.failed", worker: "standup" }, event)).toBe(
      true,
    );
    expect(matchesTrigger({ type: "job.failed", worker: "dev-task" }, event)).toBe(
      false,
    );
    expect(
      matchesTrigger({ type: "job.verify_failed" }, { ...event, type: "job.failed" }),
    ).toBe(false);
  });

  it("isSystemEventTrigger classifies system vs user trigger types", () => {
    expect(isSystemEventTrigger("job.failed")).toBe(true);
    expect(isSystemEventTrigger("job.verify_failed")).toBe(true);
    expect(isSystemEventTrigger("workflow.run.failed")).toBe(true);
    expect(isSystemEventTrigger("card.created")).toBe(false);
    expect(isSystemEventTrigger("schedule")).toBe(false);
    expect(isSystemEventTrigger(undefined)).toBe(false);
  });

  it("applyPreset with explicit autoApply passes without a gate", () => {
    const parsed = workflowStepsSchema.safeParse([
      { type: "runWorker", worker: "standup" },
      { type: "applyPreset", autoApply: true },
    ]);
    expect(parsed.success).toBe(true);
  });

  it("message.posted never fires for agent-authored messages (reply-loop guard)", () => {
    const event = {
      type: "message.posted" as const,
      workspaceId: 1,
      channelPublicId: "chn111111111",
      messagePublicId: "msg111111111",
      messageBody: "please summarize this thread",
      messageIsAgent: true,
    };
    expect(matchesTrigger({ type: "message.posted" }, event)).toBe(false);
    // Even a filter that would otherwise match stays silent for agents.
    expect(
      matchesTrigger(
        { type: "message.posted", channelPublicId: "chn111111111" },
        event,
      ),
    ).toBe(false);
    expect(
      matchesTrigger({ type: "message.posted" }, { ...event, messageIsAgent: false }),
    ).toBe(true);
  });

  it("message.posted honors channel and contains filters", () => {
    const event = {
      type: "message.posted" as const,
      workspaceId: 1,
      channelPublicId: "chn111111111",
      messagePublicId: "msg111111111",
      messageBody: "Deploy Request for the API",
      messageIsAgent: false,
    };
    expect(
      matchesTrigger(
        { type: "message.posted", channelPublicId: "chn111111111" },
        event,
      ),
    ).toBe(true);
    expect(
      matchesTrigger(
        { type: "message.posted", channelPublicId: "chn222222222" },
        event,
      ),
    ).toBe(false);
    expect(
      matchesTrigger({ type: "message.posted", contains: "deploy request" }, event),
    ).toBe(true);
    expect(
      matchesTrigger({ type: "message.posted", contains: "rollback" }, event),
    ).toBe(false);
  });

  it("postMessage step validates with and without a target channel", () => {
    expect(
      workflowStepsSchema.safeParse([
        { type: "postMessage", bodyTemplate: "hi", channelPublicId: "chn111111111" },
      ]).success,
    ).toBe(true);
    expect(
      workflowStepsSchema.safeParse([{ type: "postMessage", bodyTemplate: "hi" }])
        .success,
    ).toBe(true);
    expect(
      workflowStepsSchema.safeParse([{ type: "postMessage", bodyTemplate: "" }])
        .success,
    ).toBe(false);
  });
});
