/**
 * Console and network capture.
 *
 * Neither dodis-browser nor the Electron path it came from has this: an
 * Electron webview surfaces console output only as a renderer event, and
 * network traffic not at all. Over CDP both are ordinary protocol events,
 * which is the main practical reason this package speaks CDP directly.
 *
 * Console errors are the point. A dev-task can pass its shell verify
 * command and still render a page that throws — that is exactly the case
 * the runner needs to catch.
 */

import { maskPageText, maskUrl } from "./safety/mask";
import type { CdpConnection } from "./cdp/connection";
import type { ConsoleEntry, ConsoleLevel, NetworkEntry } from "./types";

const DEFAULT_RING = 500;

const CONSOLE_LEVELS: Record<string, ConsoleLevel> = {
  log: "log",
  info: "info",
  warning: "warning",
  error: "error",
  debug: "debug",
  verbose: "debug",
  assert: "error",
  trace: "debug",
};

function toLevel(raw: unknown): ConsoleLevel {
  return CONSOLE_LEVELS[String(raw)] ?? "log";
}

function argsToText(args: unknown): string {
  if (!Array.isArray(args)) return "";
  return args
    .map((arg) => {
      const a = arg as { value?: unknown; description?: unknown };
      if (a?.value !== undefined) return String(a.value);
      if (a?.description !== undefined) return String(a.description);
      return "";
    })
    .filter(Boolean)
    .join(" ");
}

/** Bounded ring buffer — a chatty page must not grow the server's heap. */
class Ring<T> {
  private readonly items: T[] = [];

  constructor(private readonly limit: number) {}

  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.limit) this.items.shift();
  }

  all(): T[] {
    return [...this.items];
  }

  clear(): void {
    this.items.length = 0;
  }
}

export class PageCapture {
  private readonly console = new Ring<ConsoleEntry>(DEFAULT_RING);
  private readonly network = new Ring<NetworkEntry>(DEFAULT_RING);
  private readonly offs: Array<() => void> = [];
  private readonly inflight = new Map<string, NetworkEntry>();

  constructor(
    connection: CdpConnection,
    private readonly sessionId: string,
  ) {
    this.offs.push(
      connection.on("Runtime.consoleAPICalled", (event) => {
        if (event.sessionId !== this.sessionId) return;
        this.console.push({
          level: toLevel(event.params.type),
          text: argsToText(event.params.args),
          timestamp: Date.now(),
        });
      }),
    );

    // Log.entryAdded carries what consoleAPICalled does not: uncaught
    // exceptions, failed subresource loads, CSP violations.
    this.offs.push(
      connection.on("Log.entryAdded", (event) => {
        if (event.sessionId !== this.sessionId) return;
        const entry = event.params.entry as
          | {
              level?: string;
              text?: string;
              url?: string;
              lineNumber?: number;
            }
          | undefined;
        if (!entry) return;
        this.console.push({
          level: toLevel(entry.level),
          text: String(entry.text ?? ""),
          url: entry.url,
          line: entry.lineNumber,
          timestamp: Date.now(),
        });
      }),
    );

    this.offs.push(
      connection.on("Runtime.exceptionThrown", (event) => {
        if (event.sessionId !== this.sessionId) return;
        const details = event.params.exceptionDetails as
          | {
              text?: string;
              url?: string;
              lineNumber?: number;
              exception?: { description?: string };
            }
          | undefined;
        if (!details) return;
        this.console.push({
          level: "error",
          text: details.exception?.description ?? details.text ?? "exception",
          url: details.url,
          line: details.lineNumber,
          timestamp: Date.now(),
        });
      }),
    );

    this.offs.push(
      connection.on("Network.requestWillBeSent", (event) => {
        if (event.sessionId !== this.sessionId) return;
        const requestId = String(event.params.requestId ?? "");
        const request = event.params.request as
          { url?: string; method?: string } | undefined;
        if (!requestId || !request?.url) return;
        this.inflight.set(requestId, {
          url: request.url,
          method: request.method ?? "GET",
          timestamp: Date.now(),
        });
      }),
    );

    this.offs.push(
      connection.on("Network.responseReceived", (event) => {
        if (event.sessionId !== this.sessionId) return;
        const requestId = String(event.params.requestId ?? "");
        const response = event.params.response as
          { status?: number; mimeType?: string } | undefined;
        const entry = this.inflight.get(requestId);
        if (!entry) return;
        this.inflight.delete(requestId);
        this.network.push({
          ...entry,
          status: response?.status,
          mimeType: response?.mimeType,
        });
      }),
    );

    this.offs.push(
      connection.on("Network.loadingFailed", (event) => {
        if (event.sessionId !== this.sessionId) return;
        const requestId = String(event.params.requestId ?? "");
        const entry = this.inflight.get(requestId);
        if (!entry) return;
        this.inflight.delete(requestId);
        this.network.push({
          ...entry,
          failed: true,
          errorText: String(event.params.errorText ?? "request failed"),
        });
      }),
    );
  }

  consoleEntries(level?: ConsoleLevel, mask = false): ConsoleEntry[] {
    const all = this.console.all();
    const filtered = level ? all.filter((e) => e.level === level) : all;
    if (!mask) return filtered;
    return filtered.map((e) => ({
      ...e,
      text: maskPageText(e.text),
      url: e.url ? maskUrl(e.url) : undefined,
    }));
  }

  /** Console errors, flattened — what the runner turns into a verify fail. */
  errors(mask = false): string[] {
    return this.consoleEntries("error", mask).map((e) =>
      e.url ? `${e.text} (${e.url}:${e.line ?? 0})` : e.text,
    );
  }

  networkEntries(mask = false): NetworkEntry[] {
    const all = this.network.all();
    if (!mask) return all;
    return all.map((e) => ({ ...e, url: maskUrl(e.url) }));
  }

  clear(): void {
    this.console.clear();
    this.network.clear();
    this.inflight.clear();
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.clear();
  }
}
