import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Wave B protocol layer: message.posted fan-out (with the agent
 * reply-loop guard), the postMessage step, channel-surface gates
 * (park in-thread, approve via 👍 on the gate message, reject with
 * reason), and the in-thread agent mention reply. Repos and audit are
 * mocked; assertions are the persisted run patches and posted messages.
 */

const listWorkflows = vi.fn();
const countRecentRuns = vi.fn();
const createRun = vi.fn();
const updateRun = vi.fn();
const updateWorkflow = vi.fn();
const getRunByGateMessage = vi.fn();
const getRunByPublicId = vi.fn();
const getMembership = vi.fn();
const getChannelByPublicId = vi.fn();
const getMessageByPublicId = vi.fn();
const addMessage = vi.fn();
const ensureIdentity = vi.fn();

vi.mock("../audit", () => ({ audit: vi.fn() }));
vi.mock("../webhooks", () => ({ dispatchWebhookEvent: vi.fn() }));

vi.mock("@kr8kan/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kr8kan/db")>();
  return {
    ...actual,
    workflowRepo: {
      ...actual.workflowRepo,
      listWorkflows: (...args: unknown[]) => listWorkflows(...args),
      countRecentRuns: (...args: unknown[]) => countRecentRuns(...args),
      createRun: (...args: unknown[]) => createRun(...args),
      updateRun: (...args: unknown[]) => updateRun(...args),
      updateWorkflow: (...args: unknown[]) => updateWorkflow(...args),
      getRunByGateMessage: (...args: unknown[]) => getRunByGateMessage(...args),
      getRunByPublicId: (...args: unknown[]) => getRunByPublicId(...args),
    },
    workspaceRepo: {
      ...actual.workspaceRepo,
      getMembership: (...args: unknown[]) => getMembership(...args),
    },
    channelRepo: {
      ...actual.channelRepo,
      getChannelByPublicId: (...args: unknown[]) => getChannelByPublicId(...args),
      getMessageByPublicId: (...args: unknown[]) => getMessageByPublicId(...args),
      addMessage: (...args: unknown[]) => addMessage(...args),
    },
    agentIdentityRepo: {
      ...actual.agentIdentityRepo,
      ensureIdentity: (...args: unknown[]) => ensureIdentity(...args),
    },
  };
});

import type { Database } from "@kr8kan/db";

import { postMessageMentionReply } from "../dispatchWorker";
import {
  fireTrigger,
  handleGateReaction,
  rejectGateWithReason,
  startRun,
} from "../workflowEngine";

const db = {} as Database;
const flush = () => new Promise((resolve) => setTimeout(resolve, 25));

const CHANNEL = {
  id: 5,
  publicId: "chn111111111",
  workspaceId: 1,
  name: "general",
  archivedAt: null,
  board: null,
};

function workflow(steps: unknown[], trigger: unknown) {
  return {
    id: 3,
    publicId: "wfl111111111",
    workspaceId: 1,
    name: "channel-flow",
    boardPublicId: null,
    trigger,
    steps,
    createdBy: "creator1",
  };
}

const messageEvent = {
  type: "message.posted" as const,
  workspaceId: 1,
  channelPublicId: "chn111111111",
  messagePublicId: "msg111111111",
  messageBody: "deploy request",
  messageIsAgent: false,
  actorUserId: "user1",
};

beforeEach(() => {
  for (const fn of [
    listWorkflows,
    countRecentRuns,
    createRun,
    updateRun,
    updateWorkflow,
    getRunByGateMessage,
    getRunByPublicId,
    getMembership,
    getChannelByPublicId,
    getMessageByPublicId,
    addMessage,
    ensureIdentity,
  ]) {
    fn.mockReset();
  }
  countRecentRuns.mockResolvedValue(0);
  updateRun.mockResolvedValue(undefined);
  updateWorkflow.mockResolvedValue(undefined);
  ensureIdentity.mockResolvedValue({ id: 42 });
  getChannelByPublicId.mockResolvedValue(CHANNEL);
  addMessage.mockResolvedValue({ publicId: "msgGATE11111", id: 99 });
  createRun.mockImplementation((_db: unknown, input: { triggerEvent: unknown }) =>
    Promise.resolve({
      id: 7,
      publicId: "run111111111",
      workspaceId: 1,
      status: "running",
      triggerEvent: input.triggerEvent,
      stepResults: [],
      currentStep: 0,
      cardPublicId: null,
    }),
  );
});

describe("message.posted fan-out", () => {
  it("agent-authored messages never start a run (reply-loop guard)", async () => {
    listWorkflows.mockResolvedValue([
      workflow([{ type: "postMessage", bodyTemplate: "hi" }], {
        type: "message.posted",
      }),
    ]);
    fireTrigger(db, { ...messageEvent, messageIsAgent: true });
    await flush();
    expect(listWorkflows).toHaveBeenCalled();
    expect(createRun).not.toHaveBeenCalled();
  });

  it("human messages matching the trigger start a run", async () => {
    listWorkflows.mockResolvedValue([
      workflow([{ type: "postMessage", bodyTemplate: "hi" }], {
        type: "message.posted",
        contains: "deploy",
      }),
    ]);
    fireTrigger(db, messageEvent);
    await flush();
    expect(createRun).toHaveBeenCalled();
  });
});

describe("postMessage step", () => {
  it("posts into the triggering message's thread and completes the run", async () => {
    getMessageByPublicId.mockResolvedValue({
      id: 61,
      channelId: CHANNEL.id,
      parentMessageId: null,
    });
    await startRun(
      db,
      workflow(
        [{ type: "postMessage", bodyTemplate: "ack: {{trigger.messageBody}}" }],
        { type: "message.posted" },
      ) as never,
      messageEvent,
    );
    await flush();
    expect(addMessage).toHaveBeenCalledTimes(1);
    const posted = addMessage.mock.calls[0]![1] as {
      body: string;
      parentMessageId?: number;
      agentIdentityId?: number;
    };
    expect(posted.body).toBe("ack: deploy request");
    expect(posted.parentMessageId).toBe(61);
    expect(posted.agentIdentityId).toBe(42);
    const lastPatch = updateRun.mock.calls.at(-1)![2] as { status: string };
    expect(lastPatch.status).toBe("completed");
  });

  it("fails honestly when a card-less, channel-less trigger has no target", async () => {
    await startRun(
      db,
      workflow([{ type: "postMessage", bodyTemplate: "hi" }], {
        type: "schedule",
        cron: "0 9 * * 1",
      }) as never,
      { type: "schedule", workspaceId: 1, actorUserId: "user1" },
    );
    await flush();
    expect(addMessage).not.toHaveBeenCalled();
    const lastPatch = updateRun.mock.calls.at(-1)![2] as {
      status: string;
      error?: string;
    };
    expect(lastPatch.status).toBe("failed");
    expect(lastPatch.error).toContain("postMessage needs a channel");
  });
});

describe("channel gates", () => {
  it("gate parks in the triggering thread with gateMessagePublicId", async () => {
    getMessageByPublicId.mockResolvedValue({
      id: 61,
      channelId: CHANNEL.id,
      parentMessageId: 60,
    });
    await startRun(
      db,
      workflow([{ type: "gate" }], { type: "message.posted" }) as never,
      messageEvent,
    );
    await flush();
    // One-level threads: the gate attaches to the ROOT (60), not the reply.
    const posted = addMessage.mock.calls[0]![1] as {
      body: string;
      parentMessageId?: number;
    };
    expect(posted.parentMessageId).toBe(60);
    expect(posted.body).toContain("wfrun:run111111111");
    const gatePatch = updateRun.mock.calls.at(-1)![2] as Record<string, unknown>;
    expect(gatePatch.status).toBe("waiting_gate");
    expect(gatePatch.gateMessagePublicId).toBe("msgGATE11111");
    expect(gatePatch.gateCommentPublicId).toBeNull();
  });

  const waitingRun = {
    id: 7,
    publicId: "run111111111",
    workspaceId: 1,
    status: "waiting_gate",
    currentStep: 0,
    stepResults: [{ step: 0, type: "gate", ok: true, detail: "waiting" }],
    gateMessagePublicId: "msgGATE11111",
    gateExpiresAt: new Date(Date.now() + 60_000),
    cardPublicId: null,
    triggerEvent: messageEvent,
    workflow: workflow([{ type: "gate" }], { type: "message.posted" }),
  };

  // The gate-claim guard re-reads the run (via getRunByPublicId) after
  // resolving it and again after writing the claim token, to verify the
  // write actually won. Neither race is under test here, so echo back
  // waitingRun patched with whatever token was last written — the
  // uncontested claim always succeeds.
  function mockUncontestedClaim(run: typeof waitingRun = waitingRun) {
    let claimedToken: unknown = null;
    updateRun.mockImplementation(
      (_db: unknown, _id: unknown, patch: Record<string, unknown>) => {
        if ("gateClaim" in patch) claimedToken = patch.gateClaim;
        return Promise.resolve(undefined);
      },
    );
    getRunByPublicId.mockImplementation(() =>
      Promise.resolve({ ...run, gateClaim: claimedToken }),
    );
  }

  it("👍 on the gate message resumes the run and clears both gate anchors", async () => {
    getRunByGateMessage.mockResolvedValue(waitingRun);
    getMembership.mockResolvedValue({ role: "member" });
    mockUncontestedClaim();
    const handled = await handleGateReaction(
      db,
      { id: "user2" },
      { messagePublicId: "msgGATE11111" },
      "👍",
    );
    await flush();
    expect(handled).toBe(true);
    // Call order: [0] the claim-token write, [1] the resume-to-running
    // patch, [2] executeFrom's own completion write once it finds no
    // more steps after the gate (steps.length === currentStep + 1 here).
    const resume = updateRun.mock.calls[1]![2] as Record<string, unknown>;
    expect(resume.status).toBe("running");
    expect(resume.gateMessagePublicId).toBeNull();
    expect(resume.gateCommentPublicId).toBeNull();
  });

  it("reject-with-reason works against a gate message", async () => {
    // The in-process gate-claim mutex is keyed per run+step and lives for
    // the module lifetime — this test needs its own run instance so the
    // 👍 test's claim doesn't shadow it.
    const rejectRun = { ...waitingRun, id: 8, publicId: "run222222222" };
    getRunByGateMessage.mockResolvedValue(rejectRun);
    getMembership.mockResolvedValue({ role: "member" });
    mockUncontestedClaim(rejectRun);
    const handled = await rejectGateWithReason(
      db,
      { id: "user2" },
      { messagePublicId: "msgGATE11111" },
      "wrong channel for this",
    );
    expect(handled).toBe(true);
    const patch = updateRun.mock.calls.at(-1)![2] as { status: string; error: string };
    expect(patch.status).toBe("completed");
    expect(patch.error).toBe("gate rejected: wrong channel for this");
  });
});

describe("postMessageMentionReply", () => {
  const job = {
    id: "job1111111111111",
    worker: "summarize",
    status: "completed" as const,
    result: "Here is the summary.",
    createdAt: new Date().toISOString(),
  };

  it("attaches the agent reply to the mentioning message's thread root", async () => {
    getMessageByPublicId.mockResolvedValue({
      id: 71,
      channelId: CHANNEL.id,
      parentMessageId: 70,
    });
    addMessage.mockResolvedValue({ publicId: "msgREPLY1111", id: 100 });
    await postMessageMentionReply(db, {
      channelId: CHANNEL.id,
      sourceMessagePublicId: "msg222222222",
      job,
      operatorId: "user1",
      agentIdentityId: 42,
      workspaceId: 1,
      evalOutcome: { blocked: false },
    });
    const posted = addMessage.mock.calls[0]![1] as {
      body: string;
      parentMessageId?: number;
      agentIdentityId?: number;
    };
    expect(posted.parentMessageId).toBe(70);
    expect(posted.agentIdentityId).toBe(42);
    expect(posted.body).toContain("Here is the summary.");
  });

  it("falls back to a root message when the source vanished", async () => {
    getMessageByPublicId.mockResolvedValue(null);
    await postMessageMentionReply(db, {
      channelId: CHANNEL.id,
      sourceMessagePublicId: "msg222222222",
      job,
      operatorId: "user1",
      agentIdentityId: 42,
      workspaceId: 1,
      evalOutcome: { blocked: false },
    });
    const posted = addMessage.mock.calls[0]![1] as { parentMessageId?: number };
    expect(posted.parentMessageId).toBeUndefined();
  });
});
