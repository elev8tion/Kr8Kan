import { describe, expect, it } from "vitest";

import { buildApplyActions } from "../apply-presets";

const card = "crd111111111";

describe("buildApplyActions", () => {
  it("draft-card → createCard with suggested list", () => {
    const preset = buildApplyActions(
      "draft-card",
      {
        title: "T",
        description: "D",
        checklist: ["a"],
        suggestedListPublicId: "lst111111111",
      },
      { boardPublicId: "brd111111111" },
    );
    expect(preset?.label).toBe("Create card");
    expect(preset?.actions[0]).toMatchObject({
      type: "createCard",
      listPublicId: "lst111111111",
      title: "T",
    });
  });

  it("draft-card falls back to the default list", () => {
    const preset = buildApplyActions(
      "draft-card",
      { title: "T", description: "", checklist: [] },
      { defaultListPublicId: "lstdefault11" },
    );
    expect(preset?.actions[0]).toMatchObject({ listPublicId: "lstdefault11" });
  });

  it("triage-card → move + set labels", () => {
    const preset = buildApplyActions(
      "triage-card",
      { listPublicId: "lst111111111", labelPublicIds: ["lbl111111111"] },
      { cardPublicId: card },
    );
    expect(preset?.actions.map((a) => a.type)).toEqual(["moveCard", "setLabels"]);
  });

  it("breakdown-card → appendChecklistItems", () => {
    const preset = buildApplyActions(
      "breakdown-card",
      { checklistName: "Breakdown", items: ["x", "y"] },
      { cardPublicId: card },
    );
    expect(preset?.actions[0]).toMatchObject({
      type: "appendChecklistItems",
      name: "Breakdown",
      items: ["x", "y"],
    });
  });

  it("dev-task → comment + optional check-off", () => {
    const preset = buildApplyActions(
      "dev-task",
      { what: "w", howToVerify: "v", notes: "", checklistItemsDone: ["a"] },
      { cardPublicId: card },
    );
    expect(preset?.actions.map((a) => a.type)).toEqual([
      "addComment",
      "completeChecklistItems",
    ]);
  });

  it("board-scoped results with no card are copy-only", () => {
    expect(
      buildApplyActions(
        "standup",
        { sections: { done: [], doing: [], blocked: [] } },
        { boardPublicId: "brd111111111" },
      ),
    ).toBeNull();
  });

  it("custom posts raw result as comment only when card present", () => {
    expect(
      buildApplyActions("custom", null, { cardPublicId: card, resultRaw: "hi" })
        ?.actions[0],
    ).toMatchObject({ type: "addComment", body: "hi" });
    expect(buildApplyActions("custom", null, { resultRaw: "hi" })).toBeNull();
  });
});
