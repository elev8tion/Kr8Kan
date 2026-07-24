import { describe, expect, it } from "vitest";

import { isSlackWebhookUrl, toSlackPayload } from "../webhooks";

describe("isSlackWebhookUrl", () => {
  it("matches only the Slack incoming-webhook host", () => {
    expect(
      isSlackWebhookUrl("https://hooks.slack.com/services/T00/B00/xyz"),
    ).toBe(true);
    expect(isSlackWebhookUrl("https://example.com/webhook")).toBe(false);
    expect(isSlackWebhookUrl("https://hooks.slack.com.evil.com/x")).toBe(false);
    expect(isSlackWebhookUrl("not a url")).toBe(false);
  });
});

describe("toSlackPayload", () => {
  it("card.created → header + card/board/list fields + link + context", () => {
    const out = toSlackPayload(
      "card.created",
      {
        card: { publicId: "crd111111111", title: "Fix login" },
        board: { publicId: "brd111111111", name: "Sprint" },
        list: { publicId: "lst111111111", name: "To do" },
      },
      "https://kanban.example.com",
    );
    const blocks = out.blocks as { type: string; text?: { text: string } }[];
    expect(out.text).toBe("🃏 Card created");
    expect(blocks[0]).toMatchObject({
      type: "header",
      text: { type: "plain_text", text: "🃏 Card created" },
    });
    const section = blocks[1]!.text!.text;
    expect(section).toContain("*Card:* Fix login");
    expect(section).toContain("*Board:* Sprint");
    expect(section).toContain("*List:* To do");
    expect(section).toContain(
      "<https://kanban.example.com/boards/brd111111111?card=crd111111111|Open card in Kr8Kan>",
    );
    expect(blocks[blocks.length - 1]).toMatchObject({ type: "context" });
  });

  it("workflow.gate.pending → approval heading + workflow/run fields", () => {
    const out = toSlackPayload("workflow.gate.pending", {
      workflow: { publicId: "wfl111111111", name: "Auto-triage" },
      run: { publicId: "run111111111" },
      card: { publicId: "crd111111111" },
    });
    expect(out.text).toBe("🚪 Approval needed");
    const section = (out.blocks as { text?: { text: string } }[])[1]!.text!.text;
    expect(section).toContain("*Workflow:* Auto-triage");
    expect(section).toContain("`run111111111`");
    // no baseUrl → no links
    expect(section).not.toContain("Open card");
  });

  it("unknown events get a generic bell heading", () => {
    const out = toSlackPayload("something.else", {});
    expect(out.text).toBe("🔔 something.else");
  });

  it("omits links when no base URL is configured", () => {
    const out = toSlackPayload("card.created", {
      card: { publicId: "crd111111111", title: "T" },
      board: { publicId: "brd111111111", name: "B" },
    });
    const section = (out.blocks as { text?: { text: string } }[])[1]!.text!.text;
    expect(section).not.toContain("|Open");
  });
});
