import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Sentinel-loop guards: which finished jobs fire system events, and how
 * the trigger fan-out excludes recursion paths. The db repo layer is
 * partially mocked; startRun is stopped cheaply at its rate-limit check
 * (countRecentRuns returns a huge number), so a countRecentRuns call IS
 * the assertion that a workflow made it through the fan-out filters.
 */

const listWorkflows = vi.fn();
const countRecentRuns = vi.fn();

vi.mock("@kr8kan/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kr8kan/db")>();
  return {
    ...actual,
    workflowRepo: {
      ...actual.workflowRepo,
      listWorkflows: (...args: unknown[]) => listWorkflows(...args),
      countRecentRuns: (...args: unknown[]) => countRecentRuns(...args),
    },
  };
});

import type { Database } from "@kr8kan/db";

import { jobSystemEventType } from "../dispatchWorker";
import { fireTrigger } from "../workflowEngine";

const db = {} as Database;
const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

function workflow(id: number, publicId: string, trigger: unknown) {
  return {
    id,
    publicId,
    workspaceId: 1,
    name: `wf-${id}`,
    boardPublicId: null,
    trigger,
    steps: [],
    createdBy: "user1",
  };
}

beforeEach(() => {
  listWorkflows.mockReset();
  countRecentRuns.mockReset();
  countRecentRuns.mockResolvedValue(9999); // rate-limit: stops startRun early
});

describe("jobSystemEventType", () => {
  it("classifies failed jobs and verify failures, nothing else", () => {
    expect(jobSystemEventType({ status: "failed" })).toBe("job.failed");
    expect(
      jobSystemEventType({ status: "completed", verifyStatus: "fail" }),
    ).toBe("job.verify_failed");
    expect(
      jobSystemEventType({ status: "completed", verifyStatus: "pass" }),
    ).toBeNull();
    expect(jobSystemEventType({ status: "completed" })).toBeNull();
    expect(jobSystemEventType({ status: "cancelled" })).toBeNull();
    expect(jobSystemEventType({ status: "running" })).toBeNull();
  });
});

describe("fireTrigger sentinel fan-out", () => {
  it("events carrying a workflowRunId never fan out (no chains)", async () => {
    fireTrigger(db, {
      type: "job.failed",
      workspaceId: 1,
      jobId: "j1",
      worker: "standup",
      workflowRunId: "run123",
    });
    await flush();
    expect(listWorkflows).not.toHaveBeenCalled();
  });

  it("job.failed reaches only workflows whose worker filter matches", async () => {
    listWorkflows.mockResolvedValue([
      workflow(1, "wfaaaaaaaaaa", { type: "job.failed", worker: "dev-task" }),
      workflow(2, "wfbbbbbbbbbb", { type: "job.failed" }),
      workflow(3, "wfcccccccccc", { type: "card.created" }),
    ]);
    fireTrigger(db, {
      type: "job.failed",
      workspaceId: 1,
      jobId: "j1",
      worker: "standup",
      error: "boom",
    });
    await flush();
    expect(countRecentRuns).toHaveBeenCalledTimes(1);
    expect(countRecentRuns.mock.calls[0]?.[1]).toBe(2);
  });

  it("workflow.run.failed never re-triggers the workflow that failed", async () => {
    listWorkflows.mockResolvedValue([
      workflow(1, "wfxxxxxxxxxx", { type: "workflow.run.failed" }),
      workflow(2, "wfyyyyyyyyyy", { type: "workflow.run.failed" }),
    ]);
    fireTrigger(db, {
      type: "workflow.run.failed",
      workspaceId: 1,
      error: "step 0 failed",
      failedWorkflowPublicId: "wfxxxxxxxxxx",
      failedRunPublicId: "run111111111",
    });
    await flush();
    expect(countRecentRuns).toHaveBeenCalledTimes(1);
    expect(countRecentRuns.mock.calls[0]?.[1]).toBe(2);
  });
});
