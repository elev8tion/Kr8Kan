import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Channel @mentions: same pipeline as card-comment mentions, channel
 * surface — dispatch goes through dispatchWorker with the channel and
 * source message attached, and permission-less mentions skip honestly.
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

import { handleMessageMentions } from "../mentions";

const db = {} as Database;

const input = {
  workspaceId: 1,
  channelPublicId: "chn111111111",
  boardPublicId: "brd111111111",
  messagePublicId: "msg111111111",
  messageBody: "@standup what happened this week?",
};

beforeEach(() => {
  dispatchWorker.mockReset();
  listCustomWorkers.mockReset();
  getMembership.mockReset();
  listCustomWorkers.mockResolvedValue([]);
});

describe("handleMessageMentions", () => {
  it("dispatches the mentioned worker with channel + source message", async () => {
    getMembership.mockResolvedValue({ role: "member" });
    dispatchWorker.mockResolvedValue({ id: "job1" });
    const result = await handleMessageMentions(db, { id: "user1" }, input);
    expect(result.dispatched).toEqual([{ worker: "standup", jobId: "job1" }]);
    const dispatched = dispatchWorker.mock.calls[0]![2] as Record<string, unknown>;
    expect(dispatched.channelPublicId).toBe("chn111111111");
    expect(dispatched.sourceMessagePublicId).toBe("msg111111111");
    expect(dispatched.boardPublicId).toBe("brd111111111");
    expect(dispatched.prompt).toBe("what happened this week?");
  });

  it("skips with a reason when the poster lacks agent:run", async () => {
    getMembership.mockResolvedValue({ role: "guest" });
    const result = await handleMessageMentions(db, { id: "user1" }, input);
    expect(dispatchWorker).not.toHaveBeenCalled();
    expect(result.dispatched).toEqual([]);
    expect(result.skipped[0]?.reason).toContain("agent:run");
  });

  it("ignores names that resolve to no worker", async () => {
    getMembership.mockResolvedValue({ role: "member" });
    const result = await handleMessageMentions(db, { id: "user1" }, {
      ...input,
      messageBody: "@nobody-real hello",
    });
    expect(result.dispatched).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(dispatchWorker).not.toHaveBeenCalled();
  });

  it("dispatch failures surface as skip reasons, never throw", async () => {
    getMembership.mockResolvedValue({ role: "member" });
    dispatchWorker.mockRejectedValue(
      new Error("worker standup needs a board context"),
    );
    const result = await handleMessageMentions(db, { id: "user1" }, input);
    expect(result.dispatched).toEqual([]);
    expect(result.skipped[0]?.reason).toContain("needs a board context");
  });
});
