import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Reject-with-reason: the explicit gate-rejection path that feeds the
 * rejection-learning loop. Repos are mocked; the assertions are the
 * persisted run error and the reason-carrying stepResults detail.
 */

const getRunByGateComment = vi.fn();
const updateRun = vi.fn();
const getMembership = vi.fn();

vi.mock("@kr8kan/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kr8kan/db")>();
  return {
    ...actual,
    workflowRepo: {
      ...actual.workflowRepo,
      getRunByGateComment: (...args: unknown[]) => getRunByGateComment(...args),
      updateRun: (...args: unknown[]) => updateRun(...args),
    },
    workspaceRepo: {
      ...actual.workspaceRepo,
      getMembership: (...args: unknown[]) => getMembership(...args),
    },
  };
});

import type { Database } from "@kr8kan/db";

import { rejectGateWithReason } from "../workflowEngine";

const db = {} as Database;

const gateRun = {
  id: 7,
  publicId: "run111111111",
  workspaceId: 1,
  currentStep: 1,
  stepResults: [{ step: 1, type: "gate", ok: true, detail: "pending" }],
  gateExpiresAt: new Date(Date.now() + 60_000),
  workflow: {
    id: 3,
    name: "auto-triage",
    workspaceId: 1,
    steps: [
      { type: "runWorker", worker: "triage-card" },
      { type: "gate", emoji: "👍", approvers: "member", timeoutHours: 24 },
    ],
  },
};

beforeEach(() => {
  getRunByGateComment.mockReset();
  updateRun.mockReset();
  getMembership.mockReset();
  updateRun.mockResolvedValue(undefined);
});

describe("rejectGateWithReason", () => {
  it("persists the reason on the run and in the step detail", async () => {
    getRunByGateComment.mockResolvedValue(gateRun);
    getMembership.mockResolvedValue({ role: "member" });
    const handled = await rejectGateWithReason(
      db,
      { id: "user1" },
      "cmt111111111",
      "labels are wrong for this board",
    );
    expect(handled).toBe(true);
    const [, , patch] = updateRun.mock.calls[0] as [unknown, unknown, Record<string, unknown>];
    expect(patch.status).toBe("completed");
    expect(patch.error).toBe("gate rejected: labels are wrong for this board");
    const results = patch.stepResults as { step: number; detail: string }[];
    expect(results.find((r) => r.step === 1)?.detail).toContain(
      "labels are wrong for this board",
    );
  });

  it("refuses non-members and admin-only gates for members", async () => {
    getRunByGateComment.mockResolvedValue({
      ...gateRun,
      workflow: {
        ...gateRun.workflow,
        steps: [
          { type: "runWorker", worker: "triage-card" },
          { type: "gate", emoji: "👍", approvers: "admin", timeoutHours: 24 },
        ],
      },
    });
    getMembership.mockResolvedValue({ role: "member" });
    expect(
      await rejectGateWithReason(db, { id: "user1" }, "cmt111111111", "nope"),
    ).toBe(false);
    getMembership.mockResolvedValue(null);
    expect(
      await rejectGateWithReason(db, { id: "user1" }, "cmt111111111", "nope"),
    ).toBe(false);
    expect(updateRun).not.toHaveBeenCalled();
  });

  it("returns false when the comment is not a live gate", async () => {
    getRunByGateComment.mockResolvedValue(null);
    expect(
      await rejectGateWithReason(db, { id: "user1" }, "cmt111111111", "x"),
    ).toBe(false);
  });
});
