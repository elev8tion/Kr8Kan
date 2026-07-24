import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Gated patch apply: clean applies mutate the live tree, conflicts leave
 * it untouched and report honestly. Real git repos + an in-memory job
 * store; db-touching collaborators (permissions, audit, repos) mocked.
 */

vi.mock("../permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../permissions")>();
  return { ...actual, assertPermission: vi.fn().mockResolvedValue(undefined) };
});
vi.mock("../audit", () => ({ audit: vi.fn() }));
vi.mock("@kr8kan/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kr8kan/db")>();
  return {
    ...actual,
    agentJobRepo: {
      ...actual.agentJobRepo,
      findActiveJobForProjectPath: vi.fn().mockResolvedValue(null),
    },
    boardRepo: {
      ...actual.boardRepo,
      getBoardByPublicId: vi.fn().mockResolvedValue(null),
    },
    cardRepo: {
      ...actual.cardRepo,
      getCardByPublicId: vi.fn().mockResolvedValue(null),
    },
  };
});

import type { JobRecord } from "@kr8kan/agents";
import { capturePatch, createSandbox, removeSandbox, setJobStore } from "@kr8kan/agents";
import type { Database } from "@kr8kan/db";

import { applyJobPatch } from "../patchApply";

const db = {} as Database;

function gitSync(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kr8kan-apply-repo-"));
  gitSync(dir, ["init", "-q"]);
  gitSync(dir, ["config", "user.email", "test@example.com"]);
  gitSync(dir, ["config", "user.name", "Test"]);
  await writeFile(join(dir, "app.txt"), "line1\nline2\nline3\n");
  gitSync(dir, ["add", "-A"]);
  gitSync(dir, ["commit", "-q", "-m", "init"]);
  return dir;
}

/** Produce a real patch the way the runner does: sandbox → edit → capture. */
async function makePatch(repo: string): Promise<string> {
  const sb = await createSandbox(repo, `applytest${Date.now() % 100000}`);
  try {
    await writeFile(join(sb.cwd, "app.txt"), "line1\nline2 changed\nline3\n");
    await writeFile(join(sb.cwd, "new.txt"), "fresh\n");
    const captured = await capturePatch(sb);
    return captured!.patch;
  } finally {
    await removeSandbox(sb);
  }
}

function job(repo: string, patch: string, extra?: Partial<JobRecord>): JobRecord {
  return {
    id: "jobapply1",
    worker: "dev-task",
    status: "completed",
    workspaceId: 1,
    projectPath: repo,
    sandbox: true,
    patch,
    patchSummary: "2 files changed, +2 −1",
    createdAt: new Date().toISOString(),
    ...extra,
  };
}

describe("applyJobPatch", () => {
  let repo: string;
  const updates: Record<string, unknown>[] = [];

  beforeEach(async () => {
    repo = await makeRepo();
    updates.length = 0;
    setJobStore({
      create: async () => undefined,
      update: async (_id, patch) => {
        updates.push(patch as Record<string, unknown>);
      },
      get: async () => null,
      list: async () => [],
    });
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it("applies a clean patch to the live tree and stamps the job", async () => {
    const patch = await makePatch(repo);
    const result = await applyJobPatch(db, "user1", job(repo, patch));
    expect(result.applied).toBe(true);
    expect(await readFile(join(repo, "app.txt"), "utf8")).toContain(
      "line2 changed",
    );
    expect(await readFile(join(repo, "new.txt"), "utf8")).toBe("fresh\n");
    expect(updates.some((u) => u.patchAppliedAt)).toBe(true);
  });

  it("reports a conflict honestly and leaves the live tree untouched", async () => {
    const patch = await makePatch(repo);
    // the tree moves on: same line changed differently after the sandbox run
    await writeFile(join(repo, "app.txt"), "line1\nline2 DIVERGED\nline3\n");
    gitSync(repo, ["commit", "-aqm", "diverge"]);

    const result = await applyJobPatch(db, "user1", job(repo, patch));
    expect(result.applied).toBe(false);
    expect(result.detail).toContain("no longer applies cleanly");
    // live tree exactly as the diverging commit left it — no partial apply
    expect(await readFile(join(repo, "app.txt"), "utf8")).toContain("DIVERGED");
    expect(
      await readFile(join(repo, "new.txt"), "utf8").catch(() => "missing"),
    ).toBe("missing");
    expect(updates.some((u) => u.patchApplyError)).toBe(true);
    expect(updates.some((u) => u.patchAppliedAt)).toBe(false);
  });

  it("blocks truncated patches", async () => {
    const patch = await makePatch(repo);
    await expect(
      applyJobPatch(db, "user1", job(repo, patch, { patchTruncated: true })),
    ).rejects.toThrow(/size cap/);
  });

  it("is a no-op when the patch was already applied", async () => {
    const patch = await makePatch(repo);
    const result = await applyJobPatch(
      db,
      "user1",
      job(repo, patch, { patchAppliedAt: new Date().toISOString() }),
    );
    expect(result.applied).toBe(true);
    expect(result.detail).toContain("already applied");
    expect(updates.length).toBe(0);
  });

  it("refuses non-sandbox jobs and non-completed jobs", async () => {
    const patch = await makePatch(repo);
    await expect(
      applyJobPatch(db, "user1", job(repo, patch, { sandbox: false })),
    ).rejects.toThrow(/no sandbox patch/);
    await expect(
      applyJobPatch(db, "user1", job(repo, patch, { status: "failed" })),
    ).rejects.toThrow(/only completed/);
  });
});
