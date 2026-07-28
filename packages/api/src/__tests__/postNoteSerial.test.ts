import { describe, expect, it } from "vitest";

import { serializeBoardNoteWrite } from "../workflowEngine";

/**
 * S7: postNote append is a read-modify-write against NCB (no CAS), so
 * concurrent appends to the same board note must be serialized by the
 * in-process per-board queue — otherwise both read the same base content
 * and the second write drops the first.
 */

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("serializeBoardNoteWrite", () => {
  it("runs same-board tasks strictly one after another", async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = serializeBoardNoteWrite(1, async () => {
      order.push("first:start");
      await gate;
      order.push("first:end");
    });
    const second = serializeBoardNoteWrite(1, async () => {
      order.push("second:start");
    });

    await tick();
    // Second must not have started while first is parked on the gate.
    expect(order).toEqual(["first:start"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second:start"]);
  });

  it("simulated NCB read-modify-write loses no appends when serialized", async () => {
    // Emulate the store: a shared note plus a read that returns whatever
    // was committed at read time — exactly the race in the postNote step.
    let stored = "base";
    const appendVia = (suffix: string) =>
      serializeBoardNoteWrite(2, async () => {
        const existing = stored; // getNote
        await tick(); // NCB round-trip window
        stored = `${existing}|${suffix}`; // upsertNote
      });
    await Promise.all([appendVia("a"), appendVia("b")]);
    expect(stored).toBe("base|a|b");
  });

  it("a failed write rejects its own caller but never blocks later writers", async () => {
    const failing = serializeBoardNoteWrite(3, async () => {
      throw new Error("upsert failed");
    });
    let ran = false;
    const following = serializeBoardNoteWrite(3, async () => {
      ran = true;
    });
    await expect(failing).rejects.toThrow("upsert failed");
    await following;
    expect(ran).toBe(true);
  });

  it("different boards are not serialized against each other", async () => {
    let releaseA!: () => void;
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    let bRan = false;
    const a = serializeBoardNoteWrite(4, () => gateA);
    const b = serializeBoardNoteWrite(5, async () => {
      bRan = true;
    });
    await tick();
    expect(bRan).toBe(true); // board 5 never waited on board 4
    releaseA();
    await Promise.all([a, b]);
  });
});
