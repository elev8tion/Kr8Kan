/**
 * @kr8kan/browser — a CDP-driven browser for agent verification.
 *
 * Disabled unless KR8KAN_BROWSER_ENABLED=true, and reaches nothing unless
 * KR8KAN_BROWSER_ALLOWED_HOSTS names a host. See ../NOTICE for provenance.
 */

export * from "./types";
export * from "./config";
export * from "./presets";
export * from "./snapshot";
export { PageCapture } from "./capture";
export { AgentBrowser, BrowserPage } from "./driver";
export type { BrowserSessionOptions } from "./driver";
export { CdpConnection, CdpError } from "./cdp/connection";
export { findChrome, launchChrome } from "./cdp/launcher";
export type { LaunchedBrowser } from "./cdp/launcher";
export * from "./safety/index";
