/**
 * Post-verify browser inspection.
 *
 * `verifyCommand` tells you the build exited 0. It cannot tell you the page
 * renders, and `devTaskSchema.howToVerify` is a sentence the model wrote
 * that nobody executes. This closes that gap: after the shell verify
 * passes, the *runner* — not the model — opens the board's dev URL,
 * screenshots it, and reads its console.
 *
 * The agent never drives this. It is a deterministic capture pass, so
 * there is nothing here for a prompt to talk its way around.
 *
 * Failure to capture is reported, never thrown: a browser problem must not
 * turn a completed dev-task into a failed one.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  AgentBrowser,
  browserEnabled,
  type AgentBrowserResult,
} from "@kr8kan/browser";
import { createLogger } from "@kr8kan/logger";

import type { BrowserArtifact, JobRecord } from "./types";

const logger = createLogger("browser-verify");

/** Desktop first, then the narrowest mobile breakpoint. */
const CAPTURE_PRESETS: ReadonlyArray<{ name: string; preset?: string }> = [
  { name: "desktop" },
  { name: "mobile", preset: "mobile-m" },
];

export interface BrowserVerifyResult {
  artifacts: BrowserArtifact[];
  consoleErrors: string[];
  error?: string;
}

export interface BrowserVerifyInput {
  url: string;
  jobId: string;
  /** Directory the PNGs are written under (see safety.resolveJobDir). */
  jobDir: string;
}

function resultError(result: AgentBrowserResult, what: string): string {
  return `${what} failed: ${result.error ?? "unknown error"}`;
}

export function browserVerifyAvailable(): boolean {
  return browserEnabled();
}

export async function runBrowserVerify(
  input: BrowserVerifyInput,
): Promise<BrowserVerifyResult> {
  if (!browserEnabled()) {
    return {
      artifacts: [],
      consoleErrors: [],
      error:
        "agent browser is disabled — set KR8KAN_BROWSER_ENABLED=true to capture the rendered page",
    };
  }

  let browser: AgentBrowser;
  try {
    browser = await AgentBrowser.launch();
  } catch (err) {
    return {
      artifacts: [],
      consoleErrors: [],
      error: `could not start the browser: ${(err as Error).message}`,
    };
  }

  const artifacts: BrowserArtifact[] = [];
  const consoleErrors: string[] = [];
  let error: string | undefined;

  try {
    const goto = await browser.execute({ type: "goto", url: input.url });
    if (!goto.ok) {
      return {
        artifacts,
        consoleErrors,
        error: resultError(goto, `opening ${input.url}`),
      };
    }

    const dir = join(input.jobDir, input.jobId);
    mkdirSync(dir, { recursive: true });

    for (const shot of CAPTURE_PRESETS) {
      const result = await browser.execute({
        type: "screenshot",
        fullPage: true,
        preset: shot.preset,
      });
      if (!result.ok) {
        error ??= resultError(result, `capturing the ${shot.name} screenshot`);
        continue;
      }
      const image = result.data as {
        data: string;
        width: number;
        height: number;
      };
      const buffer = Buffer.from(image.data, "base64");
      const path = join(dir, `${shot.name}.png`);
      writeFileSync(path, buffer);
      artifacts.push({
        name: shot.name,
        preset: shot.preset ?? "viewport",
        width: image.width,
        height: image.height,
        bytes: buffer.byteLength,
        path,
        capturedAt: new Date().toISOString(),
      });
    }

    // Read the console last so anything thrown during rendering or during
    // the resize between presets is included.
    const consoleResult = await browser.execute({
      type: "console",
      level: "error",
    });
    if (consoleResult.ok) {
      const entries = consoleResult.data as Array<{
        text: string;
        url?: string;
        line?: number;
      }>;
      for (const entry of entries) {
        consoleErrors.push(
          entry.url
            ? `${entry.text} (${entry.url}:${entry.line ?? 0})`
            : entry.text,
        );
      }
    } else {
      error ??= resultError(consoleResult, "reading the console");
    }
  } catch (err) {
    error ??= (err as Error).message;
  } finally {
    await browser.close().catch((err: unknown) => {
      logger.warn({ job: input.jobId, err }, "browser close failed");
    });
  }

  return { artifacts, consoleErrors, error };
}

const CONSOLE_LOG_MAX = 10;

/** Render console errors for the verify log a human reads. */
export function formatConsoleErrors(errors: readonly string[]): string {
  const shown = errors.slice(0, CONSOLE_LOG_MAX);
  const extra = errors.length - shown.length;
  const lines = shown.map((e) => `  ✕ ${e}`);
  if (extra > 0) lines.push(`  … and ${extra} more`);
  return `${errors.length} console error${errors.length === 1 ? "" : "s"} on the rendered page:\n${lines.join("\n")}`;
}

/**
 * Fold an inspection into the job patch.
 *
 * Kept out of the runner so the rule that matters — console errors fail a
 * job whose verify command passed — is a pure function with tests, rather
 * than a branch reachable only by spawning pi.
 */
export function applyBrowserVerdict(
  patch: Pick<
    JobRecord,
    | "verifyStatus"
    | "verifyLog"
    | "browserArtifacts"
    | "browserConsoleErrors"
    | "browserError"
  >,
  inspection: BrowserVerifyResult,
): void {
  if (inspection.artifacts.length > 0) {
    patch.browserArtifacts = inspection.artifacts;
  }
  if (inspection.error) {
    patch.browserError = inspection.error;
  }
  if (inspection.consoleErrors.length === 0) return;

  patch.browserConsoleErrors = inspection.consoleErrors;
  const summary = formatConsoleErrors(inspection.consoleErrors);
  // A page that throws is not verified, whatever the shell said.
  patch.verifyStatus = "fail";
  patch.verifyLog = patch.verifyLog
    ? `${patch.verifyLog}\n\n${summary}`
    : summary;
}
