import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * mentions.ts's MENTION_RE is case-insensitive (`/gi`) and worker names
 * are lowercased before matching, so `@Triage-Card` in a comment must
 * dispatch the same "triage-card" stock worker as `@triage-card`. The
 * regex itself isn't exported, so this drives the behavior through the
 * smallest exported unit — handleCommentMentions — mocking dispatch and
 * repo dependencies the same way channelMentions.test.ts does.
 */

const dispatchWorker = vi.fn();
const listCustomWorkers = vi.fn();
const getMembership = vi.fn();

vi.mock("../dispatchWorker", () => ({
  dispatchWorker: (...args: unknown[]) => dispatchWorker(...args),
}));

vi.mock("@kr8kan/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kr8kan/db")>();
  return {
    ...actual,
    customWorkerRepo: {
      ...actual.customWorkerRepo,
      listCustomWorkers: (...args: unknown[]) => listCustomWorkers(...args),
    },
    workspaceRepo: {
      ...actual.workspaceRepo,
      getMembership: (...args: unknown[]) => getMembership(...args),
    },
  };
});

import type { Database } from "@kr8kan/db";

import { handleCommentMentions } from "../mentions";

const db = {} as Database;

const baseInput = {
  workspaceId: 1,
  cardPublicId: "crd111111111",
  boardPublicId: "brd111111111",
  commentPublicId: "cmt111111111",
};

beforeEach(() => {
  dispatchWorker.mockReset();
  listCustomWorkers.mockReset();
  getMembership.mockReset();
  listCustomWorkers.mockResolvedValue([]);
  getMembership.mockResolvedValue({ role: "member" });
});

describe("handleCommentMentions case-insensitivity", () => {
  it("dispatches the triage-card worker for @Triage-Card (mixed case)", async () => {
    dispatchWorker.mockResolvedValue({ id: "job1" });
    const result = await handleCommentMentions(db, { id: "user1" }, {
      ...baseInput,
      commentBody: "@Triage-Card please sort this",
    });
    expect(result.dispatched).toEqual([{ worker: "triage-card", jobId: "job1" }]);
    expect(dispatchWorker).toHaveBeenCalledTimes(1);
    const dispatched = dispatchWorker.mock.calls[0]![2] as Record<string, unknown>;
    expect(dispatched.worker).toBe("triage-card");
  });

  it("dispatches the same worker for an all-uppercase mention", async () => {
    dispatchWorker.mockResolvedValue({ id: "job2" });
    const result = await handleCommentMentions(db, { id: "user1" }, {
      ...baseInput,
      commentBody: "@TRIAGE-CARD go",
    });
    expect(result.dispatched).toEqual([{ worker: "triage-card", jobId: "job2" }]);
  });

  it("treats @Triage-Card and @triage-card in the same comment as one mention", async () => {
    dispatchWorker.mockResolvedValue({ id: "job3" });
    const result = await handleCommentMentions(db, { id: "user1" }, {
      ...baseInput,
      commentBody: "@Triage-Card and also @triage-card again",
    });
    // Names are deduped via a lowercase Set before dispatch.
    expect(result.dispatched).toEqual([{ worker: "triage-card", jobId: "job3" }]);
    expect(dispatchWorker).toHaveBeenCalledTimes(1);
  });

  it("strips the mixed-case mention token out of the dispatched prompt", async () => {
    dispatchWorker.mockResolvedValue({ id: "job4" });
    await handleCommentMentions(db, { id: "user1" }, {
      ...baseInput,
      commentBody: "@Triage-Card please sort this card",
    });
    const dispatched = dispatchWorker.mock.calls[0]![2] as Record<string, unknown>;
    expect(dispatched.prompt).toBe("please sort this card");
  });
});
