/**
 * Agent-browser sessions with a human attached.
 *
 * `browserVerify` in the agents package runs a deterministic capture pass
 * with no confirm channel, because nobody is watching a background job
 * mid-run. Everything *here* is different: these are agent- or
 * workflow-issued commands, where a gated action can legitimately wait for
 * a person. This is where BrowserConfirmChannel gets plugged in.
 *
 * Sessions are always closed, and any confirm still parked when the
 * session ends is denied — a browser that has gone away must not leave a
 * question that could later be answered "yes".
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AgentBrowser, browserEnabled } from "@kr8kan/browser";
import { createLogger } from "@kr8kan/logger";

import { browserConfirmChannel } from "./browserConfirm";

const logger = createLogger("browser-session");

export interface BrowserSessionContext {
  /** Job id or workflow run id — whatever a pending confirm is listed under. */
  jobId: string;
  workspaceId: number;
}

export class BrowserDisabledError extends Error {
  constructor() {
    super(
      "agent browser is disabled — set KR8KAN_BROWSER_ENABLED=true and list a host in KR8KAN_BROWSER_ALLOWED_HOSTS",
    );
    this.name = "BrowserDisabledError";
  }
}

/**
 * Run `fn` against a browser whose gated actions route to a human.
 * Never leaks a browser process or a parked confirm.
 */
export async function withAgentBrowser<T>(
  context: BrowserSessionContext,
  fn: (browser: AgentBrowser) => Promise<T>,
  options: { safetyConfig?: unknown } = {},
): Promise<T> {
  if (!browserEnabled()) throw new BrowserDisabledError();

  const browser = await AgentBrowser.launch({
    safetyConfig: options.safetyConfig,
    requestConfirm: (request) =>
      browserConfirmChannel.request(context, request),
  });
  try {
    return await fn(browser);
  } finally {
    const denied = browserConfirmChannel.denyAll({ jobId: context.jobId });
    if (denied > 0) {
      logger.info(
        { job: context.jobId, denied },
        "denied confirms left parked when the browser session ended",
      );
    }
    await browser.close().catch((err: unknown) => {
      logger.warn({ job: context.jobId, err }, "browser close failed");
    });
  }
}

/** Where workflow-run screenshots land. Not the job dir — a workflow run
 * has no project folder. */
export function workflowArtifactDir(runPublicId: string): string {
  const dir = join(tmpdir(), "kr8kan-workflow-artifacts", runPublicId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export interface CapturedShot {
  path: string;
  width: number;
  height: number;
  bytes: number;
}

export function writeShot(
  dir: string,
  name: string,
  base64: string,
  width: number,
  height: number,
): CapturedShot {
  const buffer = Buffer.from(base64, "base64");
  const path = join(dir, `${name}.png`);
  writeFileSync(path, buffer);
  return { path, width, height, bytes: buffer.byteLength };
}
