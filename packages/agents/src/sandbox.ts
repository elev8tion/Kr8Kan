import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { realpath, rm } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";

import { scrubEnv } from "./safety";

/**
 * Worktree sandboxes for tool-enabled workers. Instead of editing the
 * live linked folder, a dev run gets a detached git worktree of the same
 * repo under the OS temp dir; its changes are captured as a patch on the
 * job and only reach the real tree through a human-approved apply.
 */

/** Hard cap on the stored patch (~256 KB). Beyond it the patch is kept
 * truncated for inspection but apply is blocked. */
export const PATCH_MAX_BYTES = 256 * 1024;

const GIT_TIMEOUT_MS = 30_000;
const PATCH_TRUNCATION_MARKER = "\n…[patch truncated — too large to apply]";

function git(
  cwd: string,
  args: string[],
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    execFile(
      "git",
      args,
      {
        cwd,
        env: scrubEnv() as NodeJS.ProcessEnv,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: 8 * 1024 * 1024,
      },
      (err, stdout, stderr) =>
        resolvePromise({ ok: !err, stdout: stdout ?? "", stderr: stderr ?? "" }),
    );
  });
}

/** Is this folder inside a git work tree? */
export async function isGitRepo(path: string): Promise<boolean> {
  const res = await git(path, ["rev-parse", "--is-inside-work-tree"]);
  return res.ok && res.stdout.trim() === "true";
}

export interface Sandbox {
  /** Worktree root (corresponds to the repo's top level). */
  worktreeDir: string;
  /** Where the agent runs: the worktree path matching the linked folder. */
  cwd: string;
  /** The live linked folder the sandbox was created from. */
  projectPath: string;
}

/**
 * Create a detached worktree of the linked folder's repo at HEAD.
 * Throws with an honest message when git refuses — the caller fails the
 * job rather than silently falling back to live edits.
 */
export async function createSandbox(
  projectPath: string,
  jobId: string,
): Promise<Sandbox> {
  const top = await git(projectPath, ["rev-parse", "--show-toplevel"]);
  if (!top.ok || !top.stdout.trim()) {
    throw new Error(`not a git repository: ${projectPath}`);
  }
  // Canonicalize both sides before computing the relative path — on
  // macOS tmpdir() is /var/... while git reports /private/var/..., and a
  // mismatched relative() would silently point cwd back at the LIVE tree.
  const repoRoot = await realpath(top.stdout.trim());
  const realProject = await realpath(projectPath);
  const rel = relative(repoRoot, realProject);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(
      `project folder ${projectPath} is not inside its git toplevel ${repoRoot}`,
    );
  }
  const worktreeDir = join(tmpdir(), "kr8kan-worktrees", jobId);
  const added = await git(projectPath, [
    "worktree",
    "add",
    "--detach",
    worktreeDir,
  ]);
  if (!added.ok) {
    throw new Error(
      `git worktree add failed: ${added.stderr.trim() || "unknown error"}`,
    );
  }
  return {
    worktreeDir,
    cwd: rel ? join(worktreeDir, rel) : worktreeDir,
    projectPath,
  };
}

export interface CapturedPatch {
  /** Unified diff of everything the run changed (incl. new files). */
  patch: string;
  /** Human summary, e.g. "3 files changed, +42 −7". */
  summary: string;
  /** Patch exceeded PATCH_MAX_BYTES — stored truncated, apply blocked. */
  truncated: boolean;
}

/**
 * Capture the sandbox's changes as a unified diff. Untracked files are
 * included via intent-to-add. Returns null when the run changed nothing.
 */
export async function capturePatch(
  sandbox: Sandbox,
  maxBytes = PATCH_MAX_BYTES,
): Promise<CapturedPatch | null> {
  // Intent-to-add makes new files visible to `git diff` without staging
  // content — the diff stays a pure worktree-vs-HEAD picture.
  await git(sandbox.worktreeDir, ["add", "-A", "-N"]);
  const numstat = await git(sandbox.worktreeDir, ["diff", "--numstat"]);
  const diff = await git(sandbox.worktreeDir, ["diff"]);
  if (!diff.ok) {
    throw new Error(`git diff failed: ${diff.stderr.trim() || "unknown error"}`);
  }
  const patch = diff.stdout;
  if (!patch.trim()) return null;

  let files = 0;
  let additions = 0;
  let deletions = 0;
  for (const line of numstat.stdout.split("\n")) {
    const [a, d] = line.split("\t");
    if (a === undefined || d === undefined || !line.trim()) continue;
    files += 1;
    additions += Number.parseInt(a, 10) || 0;
    deletions += Number.parseInt(d, 10) || 0;
  }
  const summary = `${files} file${files === 1 ? "" : "s"} changed, +${additions} −${deletions}`;

  if (Buffer.byteLength(patch, "utf8") > maxBytes) {
    return {
      patch: `${patch.slice(0, maxBytes)}${PATCH_TRUNCATION_MARKER}`,
      summary,
      truncated: true,
    };
  }
  return { patch, summary, truncated: false };
}

/**
 * Remove the worktree — always called, success or failure. Best-effort:
 * `git worktree remove --force`, then a plain rm + prune as fallback.
 * Never throws.
 */
export async function removeSandbox(sandbox: Sandbox): Promise<void> {
  const removed = await git(sandbox.projectPath, [
    "worktree",
    "remove",
    "--force",
    sandbox.worktreeDir,
  ]);
  if (!removed.ok) {
    await rm(sandbox.worktreeDir, { recursive: true, force: true }).catch(
      () => undefined,
    );
    await git(sandbox.projectPath, ["worktree", "prune"]);
  }
}
