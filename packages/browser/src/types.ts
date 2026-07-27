/**
 * The agent-facing command vocabulary and result shapes.
 *
 * The command union and the `{ok, data, error, safety}` envelope are
 * adapted from dodis-browser `src/shared/browser-types.ts` (MIT) — see
 * NOTICE. Differences:
 *
 *  - `eval` is gone. Handing an agent-supplied string to Runtime.evaluate
 *    is remote code execution on a server, and no confirm gate makes that
 *    acceptable. The only evaluated code is this package's own constants.
 *  - Elements are addressed by `ref` (a stable id from the accessibility
 *    snapshot) as well as by selector. Upstream had selectors only, which
 *    forced the agent to re-derive them between snapshot and action.
 *  - `scroll`, `hover`, `select`, `console` and `network` are new.
 */

export type BrowserTabId = string;

export interface BrowserTab {
  id: BrowserTabId;
  title: string;
  url: string;
  active: boolean;
  createdAt: number;
}

/** How an element is named. `ref` comes from the last snapshot. */
export interface ElementTarget {
  ref?: string;
  selector?: string;
}

export type AgentBrowserCommand =
  | { type: "goto"; url: string; waitUntil?: "load" | "domcontentloaded" }
  | { type: "back" }
  | { type: "forward" }
  | { type: "reload" }
  | ({ type: "click" } & ElementTarget)
  | ({ type: "hover" } & ElementTarget)
  | ({ type: "type"; text: string } & ElementTarget)
  | ({ type: "fill"; text: string } & ElementTarget)
  | ({ type: "select"; value: string } & ElementTarget)
  | { type: "press"; key: string }
  | { type: "scroll"; dx?: number; dy?: number }
  | { type: "snapshot"; maxNodes?: number }
  | { type: "screenshot"; fullPage?: boolean; preset?: string }
  | { type: "console"; level?: ConsoleLevel }
  | { type: "network" }
  | { type: "tabCreate"; url?: string }
  | { type: "tabClose"; tabId?: BrowserTabId }
  | { type: "tabList" }
  | { type: "tabSwitch"; tabId: BrowserTabId };

export type BrowserCommandType = AgentBrowserCommand["type"];

export interface AgentBrowserResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  safety?: {
    effect: string;
    ruleName?: string;
    reason?: string;
  };
}

export type ConsoleLevel = "log" | "info" | "warning" | "error" | "debug";

export interface ConsoleEntry {
  level: ConsoleLevel;
  text: string;
  url?: string;
  line?: number;
  timestamp: number;
}

export interface NetworkEntry {
  url: string;
  method: string;
  status?: number;
  mimeType?: string;
  failed?: boolean;
  errorText?: string;
  timestamp: number;
}

/** One node of an accessibility snapshot, addressable by `ref`. */
export interface SnapshotNode {
  ref: string;
  role: string;
  name: string;
  value?: string;
  depth: number;
  interactive: boolean;
}

export interface PageSnapshot {
  url: string;
  title: string;
  nodes: SnapshotNode[];
  /** Indented text rendering — what actually goes into a prompt. */
  text: string;
  truncated: boolean;
  masked: boolean;
}

export interface Screenshot {
  /** Base64 PNG, no data: prefix. */
  data: string;
  width: number;
  height: number;
  fullPage: boolean;
}
