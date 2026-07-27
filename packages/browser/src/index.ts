/**
 * @kr8kan/browser — a CDP-driven browser for agent verification.
 *
 * Disabled unless KR8KAN_BROWSER_ENABLED=true, and reaches nothing unless
 * KR8KAN_BROWSER_ALLOWED_HOSTS names a host. See ../NOTICE for provenance.
 */

export * from "./types.js";
export * from "./config.js";
export * from "./presets.js";
export * from "./snapshot.js";
export { PageCapture } from "./capture.js";
export { AgentBrowser, BrowserPage } from "./driver.js";
export type { BrowserSessionOptions } from "./driver.js";
export { CdpConnection, CdpError } from "./cdp/connection.js";
export { findChrome, launchChrome } from "./cdp/launcher.js";
export type { LaunchedBrowser } from "./cdp/launcher.js";
export * from "./safety/index.js";
