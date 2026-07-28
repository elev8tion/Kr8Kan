import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Reject-with-reason: the explicit gate-rejection path that feeds the
 * rejection-learning loop. Repos are mocked; the assertions are the
 * persisted run error and the reason-carrying stepResults detail.
 */

const getRunByGateComment = vi.fn();
const updateRun = vi.fn();
const getRunByPublicId = vi.fn();
const getMembership = vi.fn();

const dispatchWebhookEvent = vi.fn();

vi.mock("../webhooks", () => ({
  dispatchWebhookEvent: (...args: unknown[]) => dispatchWebhookEvent(...args),
}));

vi.mock("@kr8kan/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kr8kan/db")>();
  return {
    ...actual,
    workflowRepo: {
      ...actual.workflowRepo,
      getRunByGateComment: (...args: unknown[]) => getRunByGateComment(...args),
      updateRun: (...args: unknown[]) => updateRun(...args),
      getRunByPublicId: (...args: unknown[]) => getRunByPublicId(...args),
    },
    workspaceRepo: {
      ...actual.workspaceRepo,
      getMembership: (...args: unknown[]) => getMembership(...args),
    },
  };
});

import type { Database } from "@kr8kan/db";

import { handleGateReaction, rejectGateWithReason } from "../workflowEngine";

const db = {} as Database;

const gateRun = {
  id: 7,
  publicId: "run111111111",
  workspaceId: 1,
  status: "waiting_gate",
  currentStep: 1,
  stepResults: [{ step: 1, type: "gate", ok: true, detail: "pending" }],
  gateExpiresAt: new Date(Date.now() + 60_000),
  workflow: {
    id: 3,
    publicId: "wf1111111111",
    name: "auto-triage",
    workspaceId: 1,
    steps: [
      { type: "runWorker", worker: "triage-card" },
      { type: "gate", emoji: "👍", approvers: "member", timeoutHours: 24 },
    ],
  },
};

let claimedToken: unknown = null;

beforeEach(() => {
  getRunByGateComment.mockReset();
  updateRun.mockReset();
  getRunByPublicId.mockReset();
  getMembership.mockReset();
  dispatchWebhookEvent.mockReset();
  claimedToken = null;
  updateRun.mockImplementation(
    (_db: unknown, _id: unknown, patch: Record<string, unknown>) => {
      if ("gateClaim" in patch) claimedToken = patch.gateClaim;
      return Promise.resolve(undefined);
    },
  );
  // The gate-claim guard re-reads the run after writing the claim token
  // to verify it won — echo back whatever token was last written so the
  // (uncontested, in these tests) claim always succeeds.
  getRunByPublicId.mockImplementation(() =>
    Promise.resolve({ ...gateRun, gateClaim: claimedToken }),
  );
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
    const [, , patch] = updateRun.mock.calls.at(-1) as [
      unknown,
      unknown,
      Record<string, unknown>,
    ];
    // S12: rejection is a distinct terminal status — not "completed"
    // (success) and not "failed" (which fires the sentinel loop).
    expect(patch.status).toBe("rejected");
    expect(patch.error).toBe("gate rejected: labels are wrong for this board");
    const results = patch.stepResults as { step: number; detail: string }[];
    expect(results.find((r) => r.step === 1)?.detail).toContain(
      "labels are wrong for this board",
    );
    expect(dispatchWebhookEvent).toHaveBeenCalledWith(
      db,
      1,
      "workflow.gate.rejected",
      expect.objectContaining({
        run: { publicId: "run111111111" },
        reason: "labels are wrong for this board",
      }),
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

describe("handleGateReaction ❌ rejection", () => {
  it("persists status 'rejected' and dispatches the gate.rejected webhook", async () => {
    // Distinct run id/step: the in-process claimedGates guard is keyed
    // run.id:currentStep and persists for the whole test process.
    const rejectRun = {
      ...gateRun,
      id: 8,
      publicId: "run222222222",
      stepResults: [{ step: 1, type: "gate", ok: true, detail: "pending" }],
    };
    getRunByGateComment.mockResolvedValue(rejectRun);
    getRunByPublicId.mockImplementation(() =>
      Promise.resolve({ ...rejectRun, gateClaim: claimedToken }),
    );
    getMembership.mockResolvedValue({ role: "member" });
    const handled = await handleGateReaction(
      db,
      { id: "user2" },
      "cmt222222222",
      "❌",
    );
    expect(handled).toBe(true);
    const [, , patch] = updateRun.mock.calls.at(-1) as [
      unknown,
      unknown,
      Record<string, unknown>,
    ];
    expect(patch.status).toBe("rejected");
    expect(patch.error).toBe("gate rejected");
    expect(dispatchWebhookEvent).toHaveBeenCalledWith(
      db,
      1,
      "workflow.gate.rejected",
      expect.objectContaining({ run: { publicId: "run222222222" } }),
    );
  });
});
