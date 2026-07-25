import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import clsx from "clsx";
import {
  HiOutlineArchiveBox,
  HiOutlineChatBubbleOvalLeft,
  HiOutlineHashtag,
} from "react-icons/hi2";

import { AgentAvatar, AgentChip } from "~/components/AgentAvatar";
import { Avatar } from "~/components/Avatar";
import { Button } from "~/components/Button";
import { Dashboard } from "~/components/Dashboard";
import { useToast } from "~/providers/toast";
import { api } from "~/utils/api";
import { relativeTime } from "~/utils/format";

interface MessageItem {
  publicId: string;
  body: string;
  author: { id: string; name: string | null; image: string | null } | null;
  agent: { publicId: string; displayName: string; avatar: string } | null;
  editedAt: string | Date | null;
  createdAt: string | Date;
  replyCount?: number;
}

function MessageRow({
  message,
  onOpenThread,
  inThread,
}: {
  message: MessageItem;
  onOpenThread?: (publicId: string) => void;
  inThread?: boolean;
}) {
  return (
    <div className={clsx("flex gap-2.5", inThread && "pl-2")}>
      {message.agent ? (
        <AgentAvatar agent={message.agent} />
      ) : (
        <Avatar
          name={message.author?.name ?? "?"}
          image={message.author?.image}
        />
      )}
      <div className="min-w-0 flex-1 rounded-kr8-sm bg-kr8-bg-muted px-3 py-2">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-semibold">
            {message.agent?.displayName ?? message.author?.name ?? "Unknown"}
          </span>
          {message.agent && <AgentChip />}
          <span className="text-[11px] text-kr8-fg-muted">
            {relativeTime(message.createdAt)}
          </span>
          {message.editedAt && (
            <span className="text-[11px] text-kr8-fg-muted">(edited)</span>
          )}
        </div>
        <p className="whitespace-pre-wrap text-sm">{message.body}</p>
        {onOpenThread && (
          <button
            className="mt-1 flex items-center gap-1 text-[11px] text-kr8-fg-muted hover:text-kr8-accent"
            onClick={() => onOpenThread(message.publicId)}
          >
            <HiOutlineChatBubbleOvalLeft className="h-3.5 w-3.5" />
            {message.replyCount
              ? `${message.replyCount} ${message.replyCount === 1 ? "reply" : "replies"}`
              : "Reply"}
          </button>
        )}
      </div>
    </div>
  );
}

export default function ChannelPage() {
  const router = useRouter();
  const channelPublicId =
    typeof router.query.channelId === "string" ? router.query.channelId : "";
  const { toast } = useToast();
  const utils = api.useUtils();
  const [draft, setDraft] = useState("");
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [threadDraft, setThreadDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const channel = api.channel.byPublicId.useQuery(
    { channelPublicId },
    { enabled: channelPublicId.length === 12 },
  );
  const messages = api.channel.messages.useQuery(
    { channelPublicId },
    { enabled: channelPublicId.length === 12, refetchInterval: 30_000 },
  );
  const thread = api.channel.thread.useQuery(
    { messagePublicId: openThread ?? "" },
    { enabled: Boolean(openThread), refetchInterval: 30_000 },
  );
  const postMessage = api.channel.postMessage.useMutation({
    onSuccess: (_r, vars) => {
      if (vars.parentMessagePublicId) {
        setThreadDraft("");
        void utils.channel.thread.invalidate();
      } else {
        setDraft("");
      }
      void utils.channel.messages.invalidate();
    },
    onError: (err) => toast(err.message, "error"),
  });
  const setArchived = api.channel.setArchived.useMutation({
    onSuccess: () => {
      void utils.channel.byPublicId.invalidate();
      void utils.channel.list.invalidate();
    },
    onError: (err) => toast(err.message, "error"),
  });

  const items = ((messages.data as { messages?: MessageItem[] } | undefined)
    ?.messages ?? []) as MessageItem[];
  useEffect(() => {
    bottomRef.current?.scrollIntoView();
  }, [items.length]);

  const archived = Boolean(channel.data?.archivedAt);
  const rootOfThread = items.find((m) => m.publicId === openThread);

  return (
    <Dashboard>
      <div className="flex h-[calc(100dvh-120px)] gap-4">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-kr8-border pb-3">
            <HiOutlineHashtag className="h-5 w-5 text-kr8-fg-muted" />
            <h1 className="text-[16px] font-bold">{channel.data?.name ?? "…"}</h1>
            {channel.data?.topic && (
              <span className="hidden truncate text-[12px] text-kr8-fg-muted sm:inline">
                {channel.data.topic}
              </span>
            )}
            <span className="flex-1" />
            {archived && (
              <span className="text-[11px] font-semibold text-kr8-warning">
                Archived
              </span>
            )}
            <button
              title={archived ? "Unarchive channel" : "Archive channel"}
              className="text-kr8-fg-muted hover:text-kr8-fg"
              onClick={() =>
                setArchived.mutate({ channelPublicId, archived: !archived })
              }
            >
              <HiOutlineArchiveBox className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto py-4">
            {messages.data && items.length === 0 && (
              <p className="text-center text-sm text-kr8-fg-muted">
                Nothing here yet. Say something.
              </p>
            )}
            {items.map((m) => (
              <MessageRow
                key={m.publicId}
                message={m}
                onOpenThread={(id) => {
                  setOpenThread(id === openThread ? null : id);
                  setThreadDraft("");
                }}
              />
            ))}
            <div ref={bottomRef} />
          </div>

          {archived ? (
            <p className="border-t border-kr8-border pt-3 text-center text-[12px] text-kr8-fg-muted">
              This channel is archived — unarchive it to post.
            </p>
          ) : (
            <div className="flex gap-2 border-t border-kr8-border pt-3">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && draft.trim()) {
                    e.preventDefault();
                    postMessage.mutate({ channelPublicId, body: draft.trim() });
                  }
                }}
                rows={2}
                placeholder={`Message #${channel.data?.name ?? ""}`}
                className="flex-1 resize-none rounded-kr8-sm border border-kr8-border bg-kr8-bg px-3 py-2 text-sm outline-none focus:border-kr8-accent"
              />
              <Button
                loading={postMessage.isPending}
                disabled={!draft.trim()}
                onClick={() =>
                  postMessage.mutate({ channelPublicId, body: draft.trim() })
                }
              >
                Send
              </Button>
            </div>
          )}
        </div>

        {openThread && (
          <div className="hidden w-80 shrink-0 flex-col border-l border-kr8-border pl-4 md:flex">
            <div className="flex items-center justify-between border-b border-kr8-border pb-3">
              <h2 className="text-[14px] font-semibold">Thread</h2>
              <button
                className="text-[12px] text-kr8-fg-muted hover:text-kr8-fg"
                onClick={() => setOpenThread(null)}
              >
                Close
              </button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto py-3">
              {rootOfThread && <MessageRow message={rootOfThread} />}
              {(
                ((thread.data as { replies?: MessageItem[] } | undefined)
                  ?.replies ?? []) as MessageItem[]
              ).map((m) => (
                <MessageRow key={m.publicId} message={m} inThread />
              ))}
            </div>
            {!archived && (
              <div className="flex gap-2 border-t border-kr8-border pt-2">
                <textarea
                  value={threadDraft}
                  onChange={(e) => setThreadDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && threadDraft.trim()) {
                      e.preventDefault();
                      postMessage.mutate({
                        channelPublicId,
                        body: threadDraft.trim(),
                        parentMessagePublicId: openThread,
                      });
                    }
                  }}
                  rows={2}
                  placeholder="Reply…"
                  className="flex-1 resize-none rounded-kr8-sm border border-kr8-border bg-kr8-bg px-2 py-1.5 text-[13px] outline-none focus:border-kr8-accent"
                />
              </div>
            )}
          </div>
        )}
      </div>
    </Dashboard>
  );
}
