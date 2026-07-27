/**
 * Human-in-the-loop channel for gated browser actions.
 *
 * `BrowserActionGate` decides *that* an action needs a human; this decides
 * *how* one is asked. A gated command parks here until someone approves or
 * denies it through tRPC, or until it times out.
 *
 * Three rules, all of them deny-biased:
 *
 *  - a request nobody answers is denied when it expires, never approved
 *  - a request can only be resolved once; a late second answer is ignored
 *  - shutting the channel down denies everything still waiting, so a
 *    server restart cannot leave a command believing it was approved
 *
 * State is in-process on purpose. A parked command belongs to a live
 * promise inside this Node process — persisting the request across a
 * restart would mean persisting a resolver that no longer exists.
 */

import type { ConfirmRequest } from "@kr8kan/browser";

/** Matches the 120s deny-by-default from the desktop gate it came from. */
export const CONFIRM_TIMEOUT_MS = 120_000;

export interface PendingConfirm {
  requestId: string;
  jobId: string;
  workspaceId: number;
  summary: string;
  url: string;
  ruleName: string;
  reason: string;
  requestedAt: string;
  expiresAt: string;
}

interface Entry extends PendingConfirm {
  settle(approved: boolean): void;
  timer: NodeJS.Timeout;
}

export interface ConfirmOutcome {
  approved: boolean;
  /** False when the request was already resolved, expired, or never existed. */
  matched: boolean;
}

export interface BrowserConfirmChannelOptions {
  timeoutMs?: number;
  /** Injected for tests; defaults to wall-clock ISO strings. */
  now?(): Date;
}

export class BrowserConfirmChannel {
  private readonly pending = new Map<string, Entry>();
  private readonly timeoutMs: number;
  private readonly now: () => Date;

  constructor(options: BrowserConfirmChannelOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? CONFIRM_TIMEOUT_MS;
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Park a gated action. Resolves true only if a human says so.
   * Bind the job and workspace so a request can be listed and authorised.
   */
  request(
    context: { jobId: string; workspaceId: number },
    req: ConfirmRequest,
  ): Promise<boolean> {
    // A duplicate id would let one answer resolve two commands.
    if (this.pending.has(req.requestId)) {
      return Promise.resolve(false);
    }

    return new Promise<boolean>((resolve) => {
      const requestedAt = this.now();
      const timer = setTimeout(() => {
        this.finish(req.requestId, false);
      }, this.timeoutMs);
      // A parked confirm must never hold the process open by itself.
      timer.unref?.();

      this.pending.set(req.requestId, {
        requestId: req.requestId,
        jobId: context.jobId,
        workspaceId: context.workspaceId,
        summary: req.summary,
        url: req.url,
        ruleName: req.ruleName,
        reason: req.reason,
        requestedAt: requestedAt.toISOString(),
        expiresAt: new Date(
          requestedAt.getTime() + this.timeoutMs,
        ).toISOString(),
        settle: resolve,
        timer,
      });
    });
  }

  /** Answer a parked request. Unknown or already-settled ids report matched: false. */
  respond(requestId: string, approved: boolean): ConfirmOutcome {
    const matched = this.finish(requestId, approved);
    return { approved: matched ? approved : false, matched };
  }

  list(filter: { workspaceId: number; jobId?: string }): PendingConfirm[] {
    const out: PendingConfirm[] = [];
    for (const entry of this.pending.values()) {
      if (entry.workspaceId !== filter.workspaceId) continue;
      if (filter.jobId && entry.jobId !== filter.jobId) continue;
      const { settle: _settle, timer: _timer, ...view } = entry;
      out.push(view);
    }
    return out.sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  }

  get(requestId: string): PendingConfirm | null {
    const entry = this.pending.get(requestId);
    if (!entry) return null;
    const { settle: _settle, timer: _timer, ...view } = entry;
    return view;
  }

  size(): number {
    return this.pending.size;
  }

  /** Deny everything still parked — used on shutdown and when a job dies. */
  denyAll(filter?: { jobId?: string }): number {
    let denied = 0;
    for (const [id, entry] of [...this.pending]) {
      if (filter?.jobId && entry.jobId !== filter.jobId) continue;
      if (this.finish(id, false)) denied += 1;
    }
    return denied;
  }

  private finish(requestId: string, approved: boolean): boolean {
    const entry = this.pending.get(requestId);
    if (!entry) return false;
    this.pending.delete(requestId);
    clearTimeout(entry.timer);
    entry.settle(approved);
    return true;
  }
}

/**
 * Process-wide channel. The runner and the API layer are in the same Node
 * process (see docs/AGENTS-DEPLOYMENT.md), which is what makes a shared
 * in-memory channel workable at all.
 */
export const browserConfirmChannel = new BrowserConfirmChannel();
