import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseWorkerResult } from "../parse";

const fixture = (name: string) =>
  readFileSync(join(__dirname, "fixtures", name), "utf8");

describe("parseWorkerResult — golden fixtures", () => {
  it("draft-card", () => {
    const res = parseWorkerResult("draft-card", fixture("draft-card.md"));
    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = res.data as {
        title: string;
        checklist: string[];
        suggestedListPublicId?: string;
      };
      expect(data.title).toBe("Revamp the landing page hero");
      expect(data.checklist).toHaveLength(4);
      expect(data.suggestedListPublicId).toBe("lst1abcd2efg");
    }
  });

  it("triage-card", () => {
    const res = parseWorkerResult("triage-card", fixture("triage-card.md"));
    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = res.data as { listPublicId: string; labelPublicIds: string[] };
      expect(data.listPublicId).toBe("lst1abcd2efg");
      expect(data.labelPublicIds).toEqual(["lblaaaa1111b"]);
    }
  });

  it("breakdown-card", () => {
    const res = parseWorkerResult("breakdown-card", fixture("breakdown-card.md"));
    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = res.data as { checklistName: string; items: string[] };
      expect(data.checklistName).toBe("Breakdown");
      expect(data.items.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("standup", () => {
    const res = parseWorkerResult("standup", fixture("standup.md"));
    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = res.data as {
        sections: { done: string[]; doing: string[]; blocked: string[] };
      };
      expect(data.sections.done.length).toBeGreaterThan(0);
      expect(data.sections.blocked).toEqual([]);
    }
  });

  it("summarize-board", () => {
    const res = parseWorkerResult(
      "summarize-board",
      fixture("summarize-board.md"),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = res.data as { summary: string; highlights: string[] };
      expect(data.summary.length).toBeGreaterThan(10);
      expect(data.highlights.length).toBeGreaterThan(0);
    }
  });

  it("dev-task", () => {
    const res = parseWorkerResult("dev-task", fixture("dev-task.md"));
    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = res.data as { what: string; checklistItemsDone?: string[] };
      expect(data.what).toContain("api/health.ts");
      expect(data.checklistItemsDone).toEqual(["Add the endpoint"]);
    }
  });

  it("last fenced json block wins", () => {
    const text = [
      "```json",
      '{"summary": "wrong block", "highlights": []}',
      "```",
      "revised:",
      "```json",
      '{"summary": "right block", "highlights": ["a"]}',
      "```",
    ].join("\n");
    const res = parseWorkerResult("summarize-board", text);
    expect(res.ok).toBe(true);
    if (res.ok) expect((res.data as { summary: string }).summary).toBe("right block");
  });
});

describe("parseWorkerResult — fail closed", () => {
  it("no json block", () => {
    const res = parseWorkerResult("draft-card", "Just some markdown, no JSON.");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/no fenced/);
  });

  it("invalid JSON inside the fence", () => {
    const res = parseWorkerResult(
      "draft-card",
      '```json\n{"title": "x", trailing}\n```',
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/invalid JSON/);
  });

  it("schema mismatch (missing required field)", () => {
    const res = parseWorkerResult(
      "triage-card",
      '```json\n{"labelPublicIds": []}\n```',
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/schema mismatch/);
  });

  it("invented short publicId is rejected", () => {
    const res = parseWorkerResult(
      "triage-card",
      '```json\n{"listPublicId": "todo", "labelPublicIds": []}\n```',
    );
    expect(res.ok).toBe(false);
  });

  it("custom worker has no schema", () => {
    const res = parseWorkerResult("custom", '```json\n{"anything": 1}\n```');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/no structured-output schema/);
  });

  it("unknown worker", () => {
    const res = parseWorkerResult("nope", "```json\n{}\n```");
    expect(res.ok).toBe(false);
  });
});
