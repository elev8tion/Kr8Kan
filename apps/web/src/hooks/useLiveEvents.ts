import { useEffect, useRef, useState } from "react";

export interface LiveEvent {
  type:
    | "message.posted"
    | "message.edited"
    | "message.deleted"
    | "message.reaction";
  channelPublicId: string;
  messagePublicId?: string;
}

const BACKOFF_START_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

/**
 * Subscribe to the workspace SSE stream. Returns whether the stream is
 * currently healthy — callers keep their polling as fallback and may
 * relax the interval while `live` is true. Reconnects with capped
 * exponential backoff; never spins.
 */
export function useLiveEvents(
  workspacePublicId: string | undefined,
  onEvent: (event: LiveEvent) => void,
): boolean {
  const [live, setLive] = useState(false);
  // Ref keeps the handler fresh without resubscribing per render.
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (!workspacePublicId) return;
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let backoff = BACKOFF_START_MS;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      source = new EventSource(`/api/live/${workspacePublicId}`);
      source.onopen = () => {
        backoff = BACKOFF_START_MS;
        setLive(true);
      };
      source.onmessage = (e) => {
        try {
          handlerRef.current(JSON.parse(e.data as string) as LiveEvent);
        } catch {
          // malformed frame — ignore, the poll fallback covers us
        }
      };
      source.onerror = () => {
        source?.close();
        source = null;
        setLive(false);
        if (disposed) return;
        retryTimer = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
      };
    };
    connect();

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      source?.close();
      setLive(false);
    };
  }, [workspacePublicId]);

  return live;
}
