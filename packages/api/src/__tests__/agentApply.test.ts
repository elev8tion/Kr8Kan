import { describe, expect, it } from "vitest";

import type { JobRecord } from "@kr8kan/agents";
import type { Database } from "@kr8kan/db";

import { applyActionSchema, applyJobActions } from "../agentApply";

/** Dummy db — tests below only exercise paths that never touch it. */
const db = {} as Database;

const baseJob: JobRecord = {
  id: "job1",
  worker: "breakdown-card",
  status: "completed",
  workspaceId: 1,
  createdAt: new Date().toISOString(),
};

describe("applyActionSchema", () => {
  it("accepts each action variant", () => {
    const ok = [
      { type: "createCard", listPublicId: "lst111111111", title: "T" },
      { type: "updateCard", cardPublicId: "crd111111111", title: "T" },
      {
        type: "moveCard",
        cardPublicId: "crd111111111",
        listPublicId: "lst111111111",
      },
      {
        type: "setLabels",
        cardPublicId: "crd111111111",
        labelPublicIds: ["lbl111111111"],
      },
      {
        type: "appendChecklistItems",
        cardPublicId: "crd111111111",
        items: ["a"],
      },
      { type: "completeChecklistItems", cardPublicId: "crd111111111", items: ["a"] },
      { type: "addComment", cardPublicId: "crd111111111", body: "hi" },
      { type: "appendBoardNote", boardPublicId: "brd111111111", body: "digest" },
    ];
    for (const action of ok) {
      expect(applyActionSchema.safeParse(action).success, action.type).toBe(true);
    }
  });

  it("rejects malformed publicIds and unknown types", () => {
    expect(
      applyActionSchema.safeParse({
        type: "moveCard",
        cardPublicId: "short",
        listPublicId: "lst111111111",
      }).success,
    ).toBe(false);
    expect(
      applyActionSchema.safeParse({ type: "deleteEverything" }).success,
    ).toBe(false);
    expect(
      applyActionSchema.safeParse({
        type: "addComment",
        cardPublicId: "crd111111111",
        body: "",
      }).success,
    ).toBe(false);
    expect(
      applyActionSchema.safeParse({
        type: "appendBoardNote",
        boardPublicId: "brd111111111",
        body: "",
      }).success,
    ).toBe(false);
  });
});

describe("applyJobActions guardrails", () => {
  it("refuses jobs that are not completed", async () => {
    for (const status of ["pending", "running", "failed", "cancelled"] as const) {
      await expect(
        applyJobActions(db, "user1", { ...baseJob, status }, [
          { type: "addComment", cardPublicId: "crd111111111", body: "hi" },
        ]),
      ).rejects.toThrow(/only completed jobs/);
    }
  });

  it("re-apply of already-applied indices is a no-op", async () => {
    const job: JobRecord = {
      ...baseJob,
      appliedActions: [{ index: 0, at: new Date().toISOString() }],
    };
    const result = await applyJobActions(db, "user1", job, [
      { type: "addComment", cardPublicId: "crd111111111", body: "hi" },
    ]);
    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual([0]);
  });

  it("refuses jobs without a workspace", async () => {
    await expect(
      applyJobActions(db, "user1", { ...baseJob, workspaceId: undefined }, [
        { type: "addComment", cardPublicId: "crd111111111", body: "hi" },
      ]),
    ).rejects.toThrow(/no workspace/);
  });
});
