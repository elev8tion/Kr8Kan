import { describe, expect, it } from "vitest";

import type { ApplyAction } from "../apply-presets";
import { checkGrounding, collectContextIds, groundingReasons } from "../grounding";
import type { WorkerContext } from "../types";

const context: WorkerContext = {
  card: {
    publicId: "crd111111111",
    title: "Card",
    listPublicId: "lst111111111",
    siblings: [{ publicId: "crd222222222", title: "Sibling" }],
  },
  board: {
    publicId: "brd111111111",
    name: "Board",
    labels: [{ publicId: "lbl111111111", name: "bug" }],
    lists: [
      {
        publicId: "lst111111111",
        name: "Todo",
        cards: [{ publicId: "crd111111111", title: "Card" }],
      },
      {
        publicId: "lst222222222",
        name: "Done",
        cards: [],
      },
    ],
  },
};

describe("collectContextIds", () => {
  it("collects card, list, sibling, board, label and nested card ids", () => {
    const ids = new Set(collectContextIds(context));
    for (const id of [
      "crd111111111",
      "crd222222222",
      "lst111111111",
      "lst222222222",
      "brd111111111",
      "lbl111111111",
    ]) {
      expect(ids.has(id), id).toBe(true);
    }
  });

  it("returns empty for an empty context", () => {
    expect(collectContextIds({})).toEqual([]);
  });
});

describe("checkGrounding", () => {
  const ids = collectContextIds(context);

  it("passes when every referenced id was in context", () => {
    const actions: ApplyAction[] = [
      { type: "moveCard", cardPublicId: "crd111111111", listPublicId: "lst222222222" },
      {
        type: "setLabels",
        cardPublicId: "crd111111111",
        labelPublicIds: ["lbl111111111"],
      },
    ];
    expect(checkGrounding(actions, ids).ok).toBe(true);
  });

  it("fails on an invented id and names the field", () => {
    const actions: ApplyAction[] = [
      { type: "moveCard", cardPublicId: "crd111111111", listPublicId: "lstINVENTED1" },
    ];
    const result = checkGrounding(actions, ids);
    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { actionIndex: 0, field: "listPublicId", id: "lstINVENTED1" },
    ]);
    expect(groundingReasons(result)[0]).toContain("lstINVENTED1");
  });

  it("reports partial failures — grounded parts do not mask invented ones", () => {
    const actions: ApplyAction[] = [
      { type: "addComment", cardPublicId: "crd111111111", body: "ok" },
      {
        type: "setLabels",
        cardPublicId: "crd111111111",
        labelPublicIds: ["lbl111111111", "lblINVENTED1"],
      },
    ];
    const result = checkGrounding(actions, ids);
    expect(result.ok).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({ actionIndex: 1, id: "lblINVENTED1" });
  });

  it("accepts explicitly allowed ids (human-picked targets)", () => {
    const actions: ApplyAction[] = [
      { type: "createCard", listPublicId: "lstHUMANPICK", title: "T" },
    ];
    expect(checkGrounding(actions, ids).ok).toBe(false);
    expect(checkGrounding(actions, ids, ["lstHUMANPICK"]).ok).toBe(true);
  });
});
