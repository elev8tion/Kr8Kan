/**
 * Operator switches for the agent browser.
 *
 * Same discipline as `packages/agents/src/safety.ts`: opt in explicitly,
 * deny by default, and read the environment at call time so a process does
 * not have to restart to pick up a change. The switches live here rather
 * than in the agents package so `@kr8kan/browser` stays standalone.
 *
 * Note the separator: KR8KAN_PI_PROJECT_ROOTS is colon-separated because
 * it holds paths. Hosts are comma-separated instead — a colon already
 * means "port" in a host, and "localhost:3310" must survive parsing.
 */

import { parseAllowedHosts, type AllowedHostEntry } from "./safety/url.js";

/** Off unless the operator says otherwise. */
export function browserEnabled(): boolean {
  return process.env.KR8KAN_BROWSER_ENABLED === "true";
}

/**
 * Hosts the browser may navigate to. Empty ⇒ nothing is reachable, which
 * is the default: enabling the browser without naming a host gets you a
 * browser that can open exactly nothing.
 */
export function allowedHosts(): AllowedHostEntry[] {
  return parseAllowedHosts(
    (process.env.KR8KAN_BROWSER_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean),
  );
}

/** Explicit Chrome/Chromium binary, bypassing discovery. */
export function chromePath(): string | undefined {
  const raw = process.env.KR8KAN_BROWSER_CHROME_PATH?.trim();
  return raw ? raw : undefined;
}

/** Ceiling on any single driver command. */
export function commandTimeoutMs(): number {
  const raw = Number(process.env.KR8KAN_BROWSER_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 30_000;
}

/**
 * Concurrent pages, mirroring KR8KAN_PI_MAX_CONCURRENT. The runner is
 * in-process in the Next server, so unbounded pages are unbounded memory.
 */
export function maxPages(): number {
  const raw = Number(process.env.KR8KAN_BROWSER_MAX_PAGES);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 2;
}

/**
 * Chrome's sandbox needs user namespaces, which many containers do not
 * grant. Disabling it is a real downgrade, so it is opt-in and never the
 * default — the operator states it for their deployment.
 */
export function noSandbox(): boolean {
  return process.env.KR8KAN_BROWSER_NO_SANDBOX === "true";
}

export function assertBrowserEnabled(): void {
  if (!browserEnabled()) {
    throw new Error(
      "agent browser is disabled — opt in with KR8KAN_BROWSER_ENABLED=true",
    );
  }
  if (allowedHosts().length === 0) {
    throw new Error(
      "agent browser has no reachable hosts — set KR8KAN_BROWSER_ALLOWED_HOSTS (comma-separated, e.g. localhost:3310)",
    );
  }
}
