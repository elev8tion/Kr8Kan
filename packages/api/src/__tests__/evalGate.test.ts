import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Eval-layer gating: grounding enforcement inside applyJobActions (the
 * one choke point every apply path shares) and the pure verdict helpers.
 * The db repo layer is partially mocked — updateJob records the eval
 * verdict; a TRPC PRECONDITION_FAILED is the blocked-apply assertion.
 */

const updateJob = vi.fn();

vi.mock("@kr8kan/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kr8kan/db")>();
  return {
    ...actual,
    agentJobRepo: {
      ...actual.agentJobRepo,
      updateJob: (...args: unknown[]) => updateJob(...args),
    },
  };
});

import type { JobRecord } from "@kr8kan/agents";
import type { Database } from "@kr8kan/db";

import { applyJobActions } from "../agentApply";
import { buildJudgeDigest, evalBlocksApply } from "../evalGate";

const db = {} as Database;

const groundedJob: JobRecord = {
  id: "job1",
  worker: "triage-card",
  status: "completed",
  workspaceId: 1,
  cardPublicId: "crd111111111",
  boardPublicId: "brd111111111",
  contextIds: ["crd111111111", "lst111111111", "lbl111111111"],
  createdAt: new Date().toISOString(),
};

beforeEach(() => {
  updateJob.mockReset();
  updateJob.mockResolvedValue(undefined);
});

describe("evalBlocksApply", () => {
  it("blocks only grounding_failed and judge_failed", () => {
    expect(evalBlocksApply({ evalStatus: "grounding_failed" })).toBe(true);
    expect(evalBlocksApply({ evalStatus: "judge_failed" })).toBe(true);
    expect(evalBlocksApply({ evalStatus: "judge_warn" })).toBe(false);
    expect(evalBlocksApply({ evalStatus: "judge_pass" })).toBe(false);
    expect(evalBlocksApply({})).toBe(false);
  });
});

describe("applyJobActions grounding enforcement", () => {
  it("rejects an invented id fail-closed on the enforced path and records the verdict", async () => {
    await expect(
      applyJobActions(
        db,
        "user1",
        groundedJob,
        [
          {
            type: "moveCard",
            cardPublicId: "crd111111111",
            listPublicId: "lstINVENTED1",
          },
        ],
        { enforceGrounding: true },
      ),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(updateJob).toHaveBeenCalledWith(
      db,
      "job1",
      expect.objectContaining({ evalStatus: "grounding_failed" }),
    );
  });

  it("blocks any apply when a prior eval verdict failed", async () => {
    await expect(
      applyJobActions(
        db,
        "user1",
        { ...groundedJob, evalStatus: "judge_failed", evalReasons: ["off-task"] },
        [{ type: "addComment", cardPublicId: "crd111111111", body: "hi" }],
      ),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("does not throw for grounded ids reaching past the grounding stage", async () => {
    // Permission check hits the dummy db right after grounding passes —
    // reaching that error proves grounding accepted the action set.
    await expect(
      applyJobActions(
        db,
        "user1",
        groundedJob,
        [
          {
            type: "moveCard",
            cardPublicId: "crd111111111",
            listPublicId: "lst111111111",
          },
        ],
        { enforceGrounding: true },
      ),
    ).rejects.not.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(updateJob).not.toHaveBeenCalled();
  });

  it("jobs without contextIds (pre-eval-layer records) skip the check", async () => {
    const legacy = { ...groundedJob, contextIds: undefined };
    await expect(
      applyJobActions(
        db,
        "user1",
        legacy,
        [
          {
            type: "moveCard",
            cardPublicId: "crdANYTHING1",
            listPublicId: "lstANYTHING1",
          },
        ],
        { enforceGrounding: true },
      ),
    ).rejects.not.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});

describe("buildJudgeDigest", () => {
  it("bounds prompt/result tails and event slice", () => {
    const digest = buildJudgeDigest({
      ...groundedJob,
      prompt: "p".repeat(5000),
      result: "r".repeat(10_000),
      events: Array.from({ length: 40 }, (_, i) => ({
        at: new Date().toISOString(),
        type: `tool_${i}`,
        detail: "d".repeat(1000),
      })),
    });
    expect(digest).toContain("## Job under review");
    expect(digest.length).toBeLessThan(16_000);
    // Only the last 15 events survive.
    expect(digest).toContain("tool_39");
    expect(digest).not.toContain("tool_10:");
  });
});
