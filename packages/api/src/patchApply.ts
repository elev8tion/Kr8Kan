import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TRPCError } from "@trpc/server";

import type { JobRecord } from "@kr8kan/agents";
import { getJobStore, runVerifyCommand, scrubEnv } from "@kr8kan/agents";
import type { Database } from "@kr8kan/db";
import { agentJobRepo, boardRepo, cardRepo } from "@kr8kan/db";
import { createLogger } from "@kr8kan/logger";

import { audit } from "./audit";
import { assertPermission } from "./permissions";

const logger = createLogger("patch-apply");

/**
 * Gated patch apply: the only path a sandbox job's changes take into the
 * live linked folder. Strict `git apply --check` first — a patch that no
 * longer applies cleanly (the tree moved on) is reported honestly and
 * the live tree stays untouched. Never force-applied, always audited.
 */

const GIT_TIMEOUT_MS = 30_000;

function git(
  cwd: string,
  args: string[],
): Promise<{ ok: boolean; stderr: string }> {
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
      (err, _stdout, stderr) =>
        resolvePromise({ ok: !err, stderr: stderr ?? "" }),
    );
  });
}

export interface PatchApplyResult {
  applied: boolean;
  detail: string;
  verifyStatus?: "pass" | "fail";
  verifyLog?: string;
}

export async function applyJobPatch(
  db: Database,
  userId: string,
  job: JobRecord,
): Promise<PatchApplyResult> {
  if (!job.workspaceId) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "job has no workspace — cannot apply",
    });
  }
  await assertPermission(db, userId, job.workspaceId, "agent:run");

  if (job.status !== "completed") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `job is ${job.status} — only completed jobs can be applied`,
    });
  }
  if (!job.sandbox || !job.patch?.trim()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "job has no sandbox patch to apply",
    });
  }
  if (job.patchTruncated) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "patch exceeded the size cap and is stored truncated — apply is blocked; re-run the task with a smaller change",
    });
  }
  if (job.patchAppliedAt) {
    return { applied: true, detail: "patch was already applied" };
  }
  if (!job.projectPath) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "job has no project folder",
    });
  }

  // The live tree is a mutation target now — take the same folder lock a
  // live-edit run would: no apply while a live tools job holds the folder.
  const holder = await agentJobRepo.findActiveJobForProjectPath(
    db,
    job.projectPath,
  );
  if (holder) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Project folder is in use by job ${holder.publicId} (${holder.worker}, ${holder.status}) — wait or cancel it first`,
    });
  }

  const store = getJobStore();
  const tmp = await mkdtemp(join(tmpdir(), "kr8kan-patch-"));
  const patchFile = join(tmp, `${job.id}.patch`);
  try {
    await writeFile(patchFile, job.patch, "utf8");

    // Strict dry-run first: only a cleanly-applying patch proceeds. The
    // real apply then uses --3way, which the passed check makes safe.
    const check = await git(job.projectPath, ["apply", "--check", patchFile]);
    if (!check.ok) {
      const detail = `patch no longer applies cleanly — the project has changed since the sandbox run: ${check.stderr.trim().slice(0, 500)}`;
      await store.update(job.id, { patchApplyError: detail });
      audit(db, {
        workspaceId: job.workspaceId,
        eventType: "agent.patch.apply_failed",
        entityType: "agent_job",
        entityPublicId: job.id,
        actorUserId: userId,
        actorAgentId: job.agentIdentityId ?? null,
        payload: { worker: job.worker, detail },
      });
      await postFollowUp(
        db,
        job,
        userId,
        `⚠️ **Patch not applied** — ${detail}\n\nRe-run the task to produce a fresh patch against the current tree.`,
      );
      return { applied: false, detail };
    }

    const applied = await git(job.projectPath, ["apply", "--3way", patchFile]);
    if (!applied.ok) {
      const detail = `git apply failed after a passing check: ${applied.stderr.trim().slice(0, 500)}`;
      await store.update(job.id, { patchApplyError: detail });
      audit(db, {
        workspaceId: job.workspaceId,
        eventType: "agent.patch.apply_failed",
        entityType: "agent_job",
        entityPublicId: job.id,
        actorUserId: userId,
        actorAgentId: job.agentIdentityId ?? null,
        payload: { worker: job.worker, detail },
      });
      await postFollowUp(db, job, userId, `⚠️ **Patch apply failed** — ${detail}`);
      return { applied: false, detail };
    }

    const appliedAt = new Date().toISOString();
    await store.update(job.id, {
      patchAppliedAt: appliedAt,
      patchApplyError: undefined,
    });
    audit(db, {
      workspaceId: job.workspaceId,
      eventType: "agent.patch.applied",
      entityType: "agent_job",
      entityPublicId: job.id,
      actorUserId: userId,
      actorAgentId: job.agentIdentityId ?? null,
      payload: { worker: job.worker, summary: job.patchSummary ?? null },
    });
    logger.info(
      { job: job.id, worker: job.worker, summary: job.patchSummary },
      "sandbox patch applied to live folder",
    );

    // Post-apply verification in the LIVE tree, when the board has a
    // verify command — reported as a follow-up, never rolled back
    // automatically (the human just approved; they decide what's next).
    let verifyStatus: "pass" | "fail" | undefined;
    let verifyLog: string | undefined;
    const board = job.boardPublicId
      ? await boardRepo.getBoardByPublicId(db, job.boardPublicId)
      : null;
    if (board?.agentVerifyCommand) {
      const verdict = await runVerifyCommand(
        job.projectPath,
        board.agentVerifyCommand,
      );
      verifyStatus = verdict.verifyStatus;
      verifyLog = verdict.verifyLog;
    }
    const verifyNote =
      verifyStatus === undefined
        ? ""
        : verifyStatus === "pass"
          ? "\n\n✅ Live-tree verify passed."
          : `\n\n❌ Live-tree verify FAILED:\n\`\`\`\n${(verifyLog ?? "").slice(-1500)}\n\`\`\``;
    await postFollowUp(
      db,
      job,
      userId,
      `📦 **Patch applied** to the live project folder (${job.patchSummary ?? "diff"}).${verifyNote}`,
    );
    return { applied: true, detail: "patch applied", verifyStatus, verifyLog };
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Follow-up comment on the job's card, as the job's agent identity —
 * best-effort: a missing card never blocks the apply outcome. */
async function postFollowUp(
  db: Database,
  job: JobRecord,
  userId: string,
  body: string,
): Promise<void> {
  if (!job.cardPublicId) return;
  try {
    const card = await cardRepo.getCardByPublicId(db, job.cardPublicId);
    if (!card || card.list.board.workspaceId !== job.workspaceId) return;
    await cardRepo.addComment(db, {
      cardId: card.id,
      comment: body,
      userId,
      agentIdentityId: job.agentIdentityId ?? undefined,
    });
  } catch (err) {
    logger.warn({ job: job.id, err }, "patch-apply follow-up comment failed");
  }
}
