import { chmodSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { cancelJob, getJob, runWorker } from "../runner";

const FIXTURE_PI = join(__dirname, "fixtures", "fake-pi.sh");
const JOB_DIR = ".kr8kan/test-jobs";

async function waitForTerminal(id: string, timeoutMs = 15_000) {
  const start = Date.now();
  for (;;) {
    const job = await getJob(id);
    if (
      job &&
      (job.status === "completed" ||
        job.status === "failed" ||
        job.status === "cancelled")
    ) {
      return job;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`job ${id} did not finish (last: ${job?.status})`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe("runner against a mock pi binary", () => {
  beforeAll(() => {
    chmodSync(FIXTURE_PI, 0o755);
    process.env.PI_BIN = FIXTURE_PI;
    process.env.KR8KAN_PI_JOB_DIR = JOB_DIR;
    delete process.env.KR8KAN_PI_MODEL;
  });

  afterAll(async () => {
    delete process.env.PI_BIN;
    delete process.env.KR8KAN_PI_JOB_DIR;
    await rm(join(process.cwd(), "..", "..", JOB_DIR), {
      recursive: true,
      force: true,
    }).catch(() => undefined);
  });

  it("runs to completion and parses the structured result", { timeout: 20_000 }, async () => {
    const job = await runWorker({
      worker: "summarize-board",
      context: {
        board: { publicId: "brd111111111", name: "Test board", lists: [] },
      },
      prompt: "summarize",
    });
    expect(["pending", "running"]).toContain(job.status);

    const finished = await waitForTerminal(job.id);
    expect(finished.status).toBe("completed");
    expect(finished.result).toContain("all good");
    expect(finished.parseError).toBeUndefined();
    expect(finished.resultParsed).toMatchObject({
      summary: "all good — 2 lists, 3 cards, nothing overdue",
      highlights: ["Done list is growing"],
    });
    expect(finished.promptVersion).toBe(2);
  });

  it("cancel persists even after the job already finished starting up", { timeout: 20_000 }, async () => {
    const job = await runWorker({
      worker: "custom",
      context: {
        card: { publicId: "crd111111111", title: "A card" },
      },
      prompt: "do nothing",
    });
    const cancelled = await cancelJob(job.id);
    expect(cancelled).toBe(true);
    const stored = await waitForTerminal(job.id);
    expect(stored.status).toBe("cancelled");
    // finalize must not overwrite the persisted cancel
    await new Promise((r) => setTimeout(r, 800));
    const after = await getJob(job.id);
    expect(after?.status).toBe("cancelled");
  });
});
