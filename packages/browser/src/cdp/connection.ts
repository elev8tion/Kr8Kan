/**
 * Chrome DevTools Protocol transport.
 *
 * One WebSocket to the browser endpoint, multiplexed over `sessionId` so
 * every page attached via Target.attachToTarget shares it (flat mode).
 * Responsibilities stop here: correlate command ids with replies, fan out
 * events, and make sure no promise is left hanging when the socket dies.
 */

import { WebSocket } from "ws";

export interface CdpEvent {
  method: string;
  params: Record<string, unknown>;
  sessionId?: string;
}

export type CdpEventHandler = (event: CdpEvent) => void;

interface PendingCommand {
  resolve(value: Record<string, unknown>): void;
  reject(reason: Error): void;
  timer: NodeJS.Timeout;
  method: string;
}

interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  sessionId?: string;
  result?: Record<string, unknown>;
  error?: { code?: number; message?: string };
}

export class CdpError extends Error {
  constructor(
    message: string,
    readonly method: string,
  ) {
    super(message);
    this.name = "CdpError";
  }
}

export class CdpConnection {
  private nextId = 0;
  private readonly pending = new Map<number, PendingCommand>();
  private readonly handlers = new Map<string, Set<CdpEventHandler>>();
  private closed = false;

  private constructor(private readonly ws: WebSocket) {
    ws.on("message", (raw) => this.handleMessage(String(raw)));
    ws.on("close", () => this.failAll(new Error("CDP socket closed")));
    ws.on("error", (err) => this.failAll(err as Error));
  }

  static connect(url: string, timeoutMs = 10_000): Promise<CdpConnection> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, {
        // Chrome sends whole DOM/AX payloads down this socket; the default
        // 100 MB cap is fine but the perMessageDeflate cost is not worth it.
        perMessageDeflate: false,
        maxPayload: 256 * 1024 * 1024,
      });
      const timer = setTimeout(() => {
        ws.terminate();
        reject(new Error(`timed out connecting to CDP at ${url}`));
      }, timeoutMs);

      ws.once("open", () => {
        clearTimeout(timer);
        resolve(new CdpConnection(ws));
      });
      ws.once("error", (err) => {
        clearTimeout(timer);
        reject(err as Error);
      });
    });
  }

  send<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
    timeoutMs = 30_000,
  ): Promise<T> {
    if (this.closed) {
      return Promise.reject(new CdpError("connection is closed", method));
    }
    this.nextId += 1;
    const id = this.nextId;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new CdpError(`${method} timed out after ${timeoutMs}ms`, method),
        );
      }, timeoutMs);

      this.pending.set(id, {
        resolve: resolve as PendingCommand["resolve"],
        reject,
        timer,
        method,
      });

      const payload: CdpMessage = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      try {
        this.ws.send(JSON.stringify(payload));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new CdpError((err as Error).message, method));
      }
    });
  }

  /** Subscribe to an event. Returns an unsubscribe function. */
  on(method: string, handler: CdpEventHandler): () => void {
    let set = this.handlers.get(method);
    if (!set) {
      set = new Set();
      this.handlers.set(method, set);
    }
    set.add(handler);
    return () => {
      set.delete(handler);
      if (set.size === 0) this.handlers.delete(method);
    };
  }

  /** Resolve on the next matching event, or reject on timeout. */
  once(
    method: string,
    options: {
      sessionId?: string;
      timeoutMs?: number;
      predicate?(event: CdpEvent): boolean;
    } = {},
  ): Promise<CdpEvent> {
    const { sessionId, timeoutMs = 30_000, predicate } = options;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new CdpError(`waiting for ${method} timed out`, method));
      }, timeoutMs);

      const off = this.on(method, (event) => {
        if (sessionId && event.sessionId !== sessionId) return;
        if (predicate && !predicate(event)) return;
        clearTimeout(timer);
        off();
        resolve(event);
      });
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.failAll(new Error("connection closed by caller"));
    try {
      this.ws.close();
    } catch {
      this.ws.terminate();
    }
  }

  private handleMessage(raw: string): void {
    let message: CdpMessage;
    try {
      message = JSON.parse(raw) as CdpMessage;
    } catch {
      return; // A malformed frame is not worth tearing the session down.
    }

    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(
          new CdpError(
            message.error.message ?? "unknown CDP error",
            pending.method,
          ),
        );
        return;
      }
      pending.resolve(message.result ?? {});
      return;
    }

    if (!message.method) return;
    const set = this.handlers.get(message.method);
    if (!set || set.size === 0) return;
    const event: CdpEvent = {
      method: message.method,
      params: message.params ?? {},
      sessionId: message.sessionId,
    };
    // Copy before iterating — a handler may unsubscribe itself.
    for (const handler of [...set]) {
      try {
        handler(event);
      } catch {
        // A listener must never break protocol dispatch.
      }
    }
  }

  private failAll(reason: Error): void {
    this.closed = true;
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(reason);
    }
    this.pending.clear();
  }
}
