import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  PATCH_MAX_BYTES,
  capturePatch,
  createSandbox,
  isGitRepo,
  removeSandbox,
} from "../sandbox";
import type { Sandbox } from "../sandbox";

function gitSync(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kr8kan-sbx-repo-"));
  gitSync(dir, ["init", "-q"]);
  gitSync(dir, ["config", "user.email", "test@example.com"]);
  gitSync(dir, ["config", "user.name", "Test"]);
  await writeFile(join(dir, "tracked.txt"), "original\n");
  gitSync(dir, ["add", "-A"]);
  gitSync(dir, ["commit", "-q", "-m", "init"]);
  return dir;
}

describe("sandbox worktrees", () => {
  let repo: string;
  const sandboxes: Sandbox[] = [];

  beforeEach(async () => {
    repo = await makeRepo();
  });

  afterEach(async () => {
    for (const sb of sandboxes.splice(0)) {
      await removeSandbox(sb);
    }
    await rm(repo, { recursive: true, force: true });
  });

  it("detects git and non-git folders", async () => {
    expect(await isGitRepo(repo)).toBe(true);
    const plain = await mkdtemp(join(tmpdir(), "kr8kan-sbx-plain-"));
    expect(await isGitRepo(plain)).toBe(false);
    await rm(plain, { recursive: true, force: true });
  });

  it("creates a worktree, captures modified + untracked files, cleans up", async () => {
    const sb = await createSandbox(repo, "jobsbx1");
    sandboxes.push(sb);
    expect(existsSync(sb.cwd)).toBe(true);
    expect(sb.cwd).not.toBe(repo);

    await writeFile(join(sb.cwd, "tracked.txt"), "original\nchanged\n");
    await writeFile(join(sb.cwd, "brand-new.txt"), "hello\n");

    const captured = await capturePatch(sb);
    expect(captured).not.toBeNull();
    expect(captured!.truncated).toBe(false);
    expect(captured!.patch).toContain("tracked.txt");
    expect(captured!.patch).toContain("brand-new.txt");
    expect(captured!.patch).toContain("+changed");
    expect(captured!.summary).toMatch(/2 files changed, \+\d+ −\d+/);

    await removeSandbox(sandboxes.pop()!);
    expect(existsSync(sb.worktreeDir)).toBe(false);
    // the live repo was never touched
    expect(await isGitRepo(repo)).toBe(true);
  });

  it("returns null when the run changed nothing", async () => {
    const sb = await createSandbox(repo, "jobsbx2");
    sandboxes.push(sb);
    expect(await capturePatch(sb)).toBeNull();
  });

  it("truncates oversized patches and blocks apply via the flag", async () => {
    const sb = await createSandbox(repo, "jobsbx3");
    sandboxes.push(sb);
    await writeFile(join(sb.cwd, "big.txt"), `${"x".repeat(64)}\n`.repeat(1024));
    const captured = await capturePatch(sb, 4096);
    expect(captured).not.toBeNull();
    expect(captured!.truncated).toBe(true);
    expect(captured!.patch).toContain("[patch truncated");
    expect(captured!.patch.length).toBeLessThan(8192);
    expect(PATCH_MAX_BYTES).toBe(256 * 1024);
  });

  it("refuses to sandbox a non-git folder", async () => {
    const plain = await mkdtemp(join(tmpdir(), "kr8kan-sbx-plain-"));
    await expect(createSandbox(plain, "jobsbx4")).rejects.toThrow(
      /not a git repository/,
    );
    await rm(plain, { recursive: true, force: true });
  });

  it("cleanup is safe to call twice (failure-path idempotence)", async () => {
    const sb = await createSandbox(repo, "jobsbx5");
    await removeSandbox(sb);
    await removeSandbox(sb); // must not throw
    expect(existsSync(sb.worktreeDir)).toBe(false);
  });
});
