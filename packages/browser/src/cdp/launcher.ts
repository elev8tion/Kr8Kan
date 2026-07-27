/**
 * Chrome discovery, launch and lifecycle.
 *
 * The runner is in-process inside the Next server, so a leaked Chrome is a
 * leaked process tree on the operator's machine for as long as the server
 * lives. Every launch registers an exit hook and every close is idempotent.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { accessSync, constants, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromePath as configuredChromePath, noSandbox } from "../config.js";

const MACOS_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
];

const LINUX_CANDIDATES = [
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/microsoft-edge",
  "/snap/bin/chromium",
];

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function findChrome(): string {
  const configured = configuredChromePath();
  if (configured) {
    if (!isExecutable(configured)) {
      throw new Error(
        `KR8KAN_BROWSER_CHROME_PATH is not an executable: ${configured}`,
      );
    }
    return configured;
  }
  const candidates =
    process.platform === "darwin" ? MACOS_CANDIDATES : LINUX_CANDIDATES;
  const found = candidates.find(isExecutable);
  if (!found) {
    throw new Error(
      "no Chrome or Chromium binary found — install one or set KR8KAN_BROWSER_CHROME_PATH",
    );
  }
  return found;
}

const DEVTOOLS_RE = /^DevTools listening on (ws:\/\/\S+)/m;

export interface LaunchedBrowser {
  webSocketDebuggerUrl: string;
  process: ChildProcess;
  close(): void;
}

function baseArgs(userDataDir: string): string[] {
  const args = [
    "--headless=new",
    // Port 0 makes the kernel pick; the real one arrives on stderr.
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-breakpad",
    "--disable-client-side-phishing-detection",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-sync",
    "--disable-translate",
    "--metrics-recording-only",
    "--mute-audio",
    "--no-service-autorun",
    // Small /dev/shm in containers makes the renderer crash on big pages.
    "--disable-dev-shm-usage",
    "--hide-scrollbars",
  ];
  if (noSandbox()) {
    args.push("--no-sandbox", "--disable-setuid-sandbox");
  }
  return args;
}

export async function launchChrome(
  timeoutMs = 30_000,
): Promise<LaunchedBrowser> {
  const binary = findChrome();
  const userDataDir = mkdtempSync(join(tmpdir(), "kr8kan-browser-"));

  const child = spawn(binary, baseArgs(userDataDir), {
    stdio: ["ignore", "ignore", "pipe"],
    detached: false,
  });

  let closed = false;
  const cleanup = (): void => {
    if (closed) return;
    closed = true;
    process.off("exit", cleanup);
    try {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    } catch {
      // Already gone.
    }
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // A leftover temp profile is not worth throwing over.
    }
  };
  process.once("exit", cleanup);

  try {
    const webSocketDebuggerUrl = await readDevToolsUrl(child, timeoutMs);
    return { webSocketDebuggerUrl, process: child, close: cleanup };
  } catch (err) {
    cleanup();
    throw err;
  }
}

function readDevToolsUrl(
  child: ChildProcess,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const stderr = child.stderr;
    if (!stderr) {
      reject(new Error("chrome was launched without a stderr pipe"));
      return;
    }

    let buffer = "";
    const timer = setTimeout(() => {
      detach();
      reject(
        new Error(
          `chrome did not report a DevTools endpoint within ${timeoutMs}ms`,
        ),
      );
    }, timeoutMs);

    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString("utf8");
      const match = DEVTOOLS_RE.exec(buffer);
      if (!match?.[1]) {
        // Chrome is chatty on stderr; keep only enough to match the banner.
        if (buffer.length > 64 * 1024) buffer = buffer.slice(-8 * 1024);
        return;
      }
      clearTimeout(timer);
      detach();
      resolve(match[1].trim());
    };

    const onExit = (code: number | null): void => {
      clearTimeout(timer);
      detach();
      reject(new Error(`chrome exited before it was ready (code ${code})`));
    };

    function detach(): void {
      stderr?.off("data", onData);
      child.off("exit", onExit);
    }

    stderr.on("data", onData);
    child.once("exit", onExit);
  });
}
