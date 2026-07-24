import type { JobEvent, JobRecord } from "./types";

/**
 * Bounded per-job event ring: every pi event the runner sees (tool calls,
 * messages, settle/timeout/verify transitions) lands here so a finished
 * job is a replayable trace, not just a final answer. Caps are hard —
 * event capture must never grow unbounded or crash a run.
 */

/** Most events kept per job; older entries fall off the front. */
export const EVENT_RING_MAX = 200;
/** Per-event detail cap in characters (~2 KB). */
export const EVENT_DETAIL_MAX = 2048;

const TRUNCATION_MARKER = "…[truncated]";

/**
 * Append an event to the ring in place, enforcing both caps. Fail-closed:
 * any surprise (weird input, throw during stringify) is swallowed — a
 * trace gap is acceptable, a dead job is not.
 */
export function pushEvent(
  ring: JobEvent[],
  type: string,
  detail?: string,
): void {
  try {
    if (!type) return;
    const event: JobEvent = { at: new Date().toISOString(), type };
    if (detail) {
      event.detail =
        detail.length > EVENT_DETAIL_MAX
          ? `${detail.slice(0, EVENT_DETAIL_MAX)}${TRUNCATION_MARKER}`
          : detail;
    }
    ring.push(event);
    if (ring.length > EVENT_RING_MAX) {
      ring.splice(0, ring.length - EVENT_RING_MAX);
    }
  } catch {
    // never let trace capture take down a run
  }
}

/* ── failure-context injection ─────────────────────────────────────
 * When a job is re-run after a failure (or a failed verify), the new
 * run gets a clearly delimited digest of what went wrong last time:
 * the error, the verify log tail, and a slice of the event trace. */

const FAILURE_ERROR_MAX = 1000;
const FAILURE_VERIFY_TAIL_MAX = 2000;
const FAILURE_EVENTS_MAX = 15;
const FAILURE_EVENT_DETAIL_MAX = 200;
/** Hard cap on the whole injected block (~6 KB). */
export const FAILURE_CONTEXT_MAX = 6000;

/**
 * Build the "previous attempt failed" context block for a retry, or null
 * when the prior job carries nothing worth injecting.
 */
export function buildFailureContext(
  prior: Pick<
    JobRecord,
    "id" | "worker" | "status" | "error" | "verifyStatus" | "verifyLog" | "events"
  >,
): string | null {
  const failed =
    prior.status === "failed" ||
    prior.status === "cancelled" ||
    prior.verifyStatus === "fail";
  if (!failed) return null;

  const parts: string[] = [
    `## Previous attempt failed`,
    `A prior run of this worker (job ${prior.id}) did not succeed. Read the failure details below, figure out what went wrong, and take a different approach — do not repeat the same mistake.`,
    `Prior status: ${prior.status}${prior.verifyStatus ? ` (verify: ${prior.verifyStatus})` : ""}`,
  ];
  if (prior.error) {
    parts.push(`Prior error:\n${prior.error.slice(0, FAILURE_ERROR_MAX)}`);
  }
  if (prior.verifyLog) {
    parts.push(
      `Prior verify output (tail):\n${prior.verifyLog.slice(-FAILURE_VERIFY_TAIL_MAX)}`,
    );
  }
  if (prior.events?.length) {
    const tail = prior.events.slice(-FAILURE_EVENTS_MAX);
    parts.push(
      `Prior event trace (last ${tail.length} of ${prior.events.length}):\n${tail
        .map(
          (e) =>
            `- ${e.at} ${e.type}${e.detail ? `: ${e.detail.slice(0, FAILURE_EVENT_DETAIL_MAX)}` : ""}`,
        )
        .join("\n")}`,
    );
  }

  let block = parts.join("\n\n");
  if (block.length > FAILURE_CONTEXT_MAX) {
    block = `${block.slice(0, FAILURE_CONTEXT_MAX)}${TRUNCATION_MARKER}`;
  }
  return block;
}
