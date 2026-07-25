import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import { HiOutlineBell } from "react-icons/hi2";

import { useLocalStorage } from "~/hooks/useLocalStorage";
import { useWorkspace } from "~/providers/workspace";
import { api } from "~/utils/api";
import { relativeTime } from "~/utils/format";

/**
 * Header bell: agent replies, finished runs, and approvable gates from
 * my.notifications. Unread = newer than a local watermark; opening the
 * panel advances it. No server-side read state.
 */
export function NotificationBell() {
  const router = useRouter();
  const { activeWorkspace } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useLocalStorage<string>("kr8kan.notifSeen", "");
  const panelRef = useRef<HTMLDivElement>(null);

  const notifications = api.my.notifications.useQuery(
    { workspacePublicId: activeWorkspace?.publicId ?? "" },
    { enabled: Boolean(activeWorkspace), refetchInterval: 30_000 },
  );

  const items = useMemo(
    () =>
      (notifications.data ?? []) as {
        kind: "job" | "agent_comment" | "gate" | "channel";
        title: string;
        cardPublicId?: string | null;
        boardPublicId?: string | null;
        commentPublicId?: string | null;
        channelPublicId?: string | null;
        messagePublicId?: string | null;
        threadRootPublicId?: string | null;
        at: string;
      }[],
    [notifications.data],
  );
  const unread = items.filter((i) => !seen || i.at > seen).length;

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) setSeen(new Date().toISOString());
  };

  const go = (item: (typeof items)[number]) => {
    setOpen(false);
    if (item.kind === "channel" && item.channelPublicId) {
      const params = new URLSearchParams();
      if (item.messagePublicId) params.set("message", item.messagePublicId);
      if (item.threadRootPublicId) params.set("thread", item.threadRootPublicId);
      const qs = params.toString();
      void router.push(`/channels/${item.channelPublicId}${qs ? `?${qs}` : ""}`);
    } else if (item.boardPublicId && item.cardPublicId) {
      const base = `/boards/${item.boardPublicId}?card=${item.cardPublicId}`;
      void router.push(
        item.commentPublicId ? `${base}&comment=${item.commentPublicId}` : base,
      );
    } else {
      void router.push("/settings/agents");
    }
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={toggle}
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
        className="relative flex h-9 min-w-[36px] items-center justify-center rounded-kr8-sm text-kr8-fg-muted hover:bg-kr8-bg-muted hover:text-kr8-fg"
      >
        <HiOutlineBell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-kr8-accent px-1 text-[10px] font-bold text-kr8-accent-fg">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-kr8-md border border-kr8-border bg-kr8-bg-elevated shadow-kr8-md">
          <div className="border-b border-kr8-border px-3 py-2 text-[13px] font-semibold">
            Notifications
          </div>
          <ul className="max-h-80 overflow-y-auto">
            {items.map((item, i) => (
              <li key={`${item.at}-${i}`}>
                <button
                  onClick={() => go(item)}
                  className="flex min-h-[48px] w-full flex-col justify-center gap-0.5 px-3 py-2 text-left hover:bg-kr8-bg-muted"
                >
                  <span className="text-[13px]">
                    {item.kind === "gate" ? "🙋 " : item.kind === "channel" ? "💬 " : ""}
                    {item.title}
                  </span>
                  <span className="text-[11px] text-kr8-fg-muted">
                    {relativeTime(item.at)}
                  </span>
                </button>
              </li>
            ))}
            {items.length === 0 && (
              <li className="px-3 py-6 text-center text-[13px] text-kr8-fg-muted">
                Nothing yet — agent replies and approvals land here.
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
