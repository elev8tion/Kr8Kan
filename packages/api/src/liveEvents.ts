/**
 * In-process live-event pub/sub for the SSE channel stream. Single-node
 * by design (self-hosted app) — no Redis, no external broker. Payloads
 * are deliberately minimal pointers (type + publicIds); clients refetch
 * through tRPC rather than trusting pushed data, so there is no second
 * data shape to keep consistent and nothing to redact.
 */

export interface LiveEvent {
  type:
    | "message.posted"
    | "message.edited"
    | "message.deleted"
    | "message.reaction";
  channelPublicId: string;
  messagePublicId?: string;
}

type Subscriber = (event: LiveEvent) => void;

/** Survives dev hot-reload the same way the auth singleton does. */
const globalForLive = globalThis as unknown as {
  kr8kanLiveSubscribers?: Map<number, Set<Subscriber>>;
};

function subscribers(): Map<number, Set<Subscriber>> {
  globalForLive.kr8kanLiveSubscribers ??= new Map();
  return globalForLive.kr8kanLiveSubscribers;
}

/** Defensive cap; a workspace at the cap refuses new streams (the route
 * answers 503 and the client falls back to polling — honest, no drops). */
export const MAX_LIVE_SUBSCRIBERS = 100;

/**
 * Subscribe to a workspace's live events. Returns an unsubscribe
 * function, or null when the workspace is at the subscriber cap.
 */
export function subscribeLive(
  workspaceId: number,
  fn: Subscriber,
): (() => void) | null {
  const map = subscribers();
  let set = map.get(workspaceId);
  if (!set) {
    set = new Set();
    map.set(workspaceId, set);
  }
  if (set.size >= MAX_LIVE_SUBSCRIBERS) return null;
  set.add(fn);
  return () => {
    set.delete(fn);
    if (set.size === 0) map.delete(workspaceId);
  };
}

/** Fire-and-forget: a throwing subscriber never breaks the mutation
 * path or its sibling subscribers. */
export function publishLive(workspaceId: number, event: LiveEvent): void {
  const set = subscribers().get(workspaceId);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(event);
    } catch {
      // subscriber's problem, not the publisher's
    }
  }
}

/** Test hook. */
export function liveSubscriberCount(workspaceId: number): number {
  return subscribers().get(workspaceId)?.size ?? 0;
}
