import { describe, expect, it, vi } from "vitest";

/**
 * Wave A channel rules: message permission model (mirrors comments),
 * one-level thread semantics, and the public-board payload exclusion —
 * channels must never leak through the /p/ surface.
 */

import {
  canDeleteMessage,
  canEditMessage,
  resolveThreadRootId,
} from "../routers/channel";

describe("message permissions", () => {
  const human = { createdBy: "user1", agentIdentityId: null };
  const agentMsg = { createdBy: "operator1", agentIdentityId: 7 };

  it("edit is owner-only", () => {
    expect(canEditMessage(human, "user1")).toBe(true);
    expect(canEditMessage(human, "user2")).toBe(false);
  });

  it("agent messages are immutable even to their operator", () => {
    expect(canEditMessage(agentMsg, "operator1")).toBe(false);
    expect(canEditMessage(agentMsg, "someoneElse")).toBe(false);
  });

  it("delete is owner-or-admin", () => {
    expect(canDeleteMessage(human, "user1", "member")).toBe(true);
    expect(canDeleteMessage(human, "user2", "member")).toBe(false);
    expect(canDeleteMessage(human, "user2", "admin")).toBe(true);
  });

  it("admins can delete agent messages (noisy-agent cleanup)", () => {
    expect(canDeleteMessage(agentMsg, "operator1", "member")).toBe(true);
    expect(canDeleteMessage(agentMsg, "user2", "admin")).toBe(true);
    expect(canDeleteMessage(agentMsg, "user2", "guest")).toBe(false);
  });
});

describe("thread semantics (one level, Slack-style)", () => {
  it("replying to a root attaches to the root", () => {
    expect(resolveThreadRootId({ id: 10, parentMessageId: null })).toBe(10);
  });

  it("replying to a reply re-attaches to the root", () => {
    expect(resolveThreadRootId({ id: 22, parentMessageId: 10 })).toBe(10);
  });
});

describe("public board payload", () => {
  it("never exposes channels or messages, even if the repo row carries them", async () => {
    vi.doMock("@kr8kan/db", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@kr8kan/db")>();
      return {
        ...actual,
        boardRepo: {
          ...actual.boardRepo,
          getBoardWithContents: vi.fn().mockResolvedValue({
            publicId: "board1234567",
            name: "Public board",
            visibility: "public",
            workspace: {
              name: "WS",
              // Hostile fixture: workspace relation dragging channels along.
              channels: [{ publicId: "chan12345678", name: "secret-channel" }],
            },
            channels: [{ publicId: "chan12345678", name: "secret-channel" }],
            messages: [{ publicId: "msg123456789", body: "internal talk" }],
            lists: [],
          }),
        },
      };
    });
    const { boardRouter } = await import("../routers/board");
    const { createCallerFactory } = await import("../trpc");
    const caller = createCallerFactory(boardRouter)({
      db: {},
      auth: {},
      session: null,
      headers: new Headers(),
    } as never);
    const result = (await caller.publicView({
      boardPublicId: "board1234567",
    })) as Record<string, unknown>;
    expect(Object.keys(result).sort()).toEqual([
      "lists",
      "name",
      "publicId",
      "workspaceName",
    ]);
    expect(JSON.stringify(result)).not.toContain("secret-channel");
    expect(JSON.stringify(result)).not.toContain("internal talk");
    vi.doUnmock("@kr8kan/db");
  });
});
