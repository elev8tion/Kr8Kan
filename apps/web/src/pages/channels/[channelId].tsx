import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import clsx from "clsx";
import {
  HiOutlineArchiveBox,
  HiOutlineChatBubbleOvalLeft,
  HiOutlineHashtag,
  HiOutlineTrash,
} from "react-icons/hi2";

import { AgentAvatar, AgentChip } from "~/components/AgentAvatar";
import { Avatar } from "~/components/Avatar";
import { Button } from "~/components/Button";
import { Dashboard } from "~/components/Dashboard";
import { useLiveEvents } from "~/hooks/useLiveEvents";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { useToast } from "~/providers/toast";
import { useWorkspace } from "~/providers/workspace";
import { api } from "~/utils/api";
import { relativeTime } from "~/utils/format";

interface MessageReaction {
  emoji: string;
  userId: string;
}

interface MessageItem {
  publicId: string;
  body: string;
  author: { id: string; name: string | null; image: string | null } | null;
  agent: { publicId: string; displayName: string; avatar: string } | null;
  reactions?: MessageReaction[];
  editedAt: string | Date | null;
  createdAt: string | Date;
  replyCount?: number;
}

const REACTION_EMOJI = ["👍", "👎", "🎉", "👀", "🚀", "❌"] as const;
const GATE_MARKER_RE = /`wfrun:[a-z0-9]{1,32}`/;

function ReactionBar({
  message,
  userId,
  onToggle,
}: {
  message: MessageItem;
  userId?: string;
  onToggle: (messagePublicId: string, emoji: string, reacted: boolean) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const grouped = new Map<string, MessageReaction[]>();
  for (const r of message.reactions ?? []) {
    grouped.set(r.emoji, [...(grouped.get(r.emoji) ?? []), r]);
  }
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {[...grouped.entries()].map(([emoji, rows]) => {
        const reacted = rows.some((r) => r.userId === userId);
        return (
          <button
            key={emoji}
            className={clsx(
              "rounded-full border px-1.5 py-0.5 text-[11px]",
              reacted
                ? "border-kr8-accent bg-kr8-accent/10"
                : "border-kr8-border hover:border-kr8-accent",
            )}
            onClick={() => onToggle(message.publicId, emoji, reacted)}
          >
            {emoji} {rows.length}
          </button>
        );
      })}
      <button
        className="rounded-full border border-dashed border-kr8-border px-1.5 py-0.5 text-[11px] text-kr8-fg-muted hover:border-kr8-accent"
        onClick={() => setPickerOpen(!pickerOpen)}
        aria-label="Add reaction"
      >
        +
      </button>
      {pickerOpen &&
        REACTION_EMOJI.map((emoji) => (
          <button
            key={emoji}
            className="rounded-full px-1 text-[13px] hover:scale-110"
            onClick={() => {
              setPickerOpen(false);
              const reacted = (message.reactions ?? []).some(
                (r) => r.emoji === emoji && r.userId === userId,
              );
              onToggle(message.publicId, emoji, reacted);
            }}
          >
            {emoji}
          </button>
        ))}
    </div>
  );
}

function MessageRow({
  message,
  onOpenThread,
  inThread,
  userId,
  isAdmin,
  highlighted,
  onToggleReaction,
  onRejectGate,
  onEdit,
  onDelete,
}: {
  message: MessageItem;
  onOpenThread?: (publicId: string) => void;
  inThread?: boolean;
  userId?: string;
  isAdmin?: boolean;
  highlighted?: boolean;
  onToggleReaction: (
    messagePublicId: string,
    emoji: string,
    reacted: boolean,
  ) => void;
  onRejectGate?: (messagePublicId: string, reason: string) => void;
  onEdit?: (messagePublicId: string, body: string) => void;
  onDelete?: (messagePublicId: string) => void;
}) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const isGate = Boolean(message.agent) && GATE_MARKER_RE.test(message.body);
  // Mirrors the server rules exactly: edit own human messages only;
  // delete own-or-admin (agent messages: admin delete only).
  const canEdit =
    !message.agent && Boolean(userId) && message.author?.id === userId;
  const canDelete =
    (!message.agent && Boolean(userId) && message.author?.id === userId) ||
    isAdmin;
  return (
    <div
      id={`message-${message.publicId}`}
      className={clsx(
        "flex gap-2.5 rounded-kr8-sm transition-shadow duration-500",
        inThread && "pl-2",
        highlighted &&
          "ring-2 ring-kr8-accent ring-offset-2 ring-offset-kr8-bg",
      )}
    >
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
          <span className="flex-1" />
          {canEdit && onEdit && (
            <button
              className="text-[11px] text-kr8-fg-muted hover:text-kr8-fg"
              onClick={() => {
                setEditing(true);
                setEditDraft(message.body);
                setConfirmingDelete(false);
              }}
            >
              Edit
            </button>
          )}
          {canDelete && onDelete && (
            <button
              className={clsx(
                "text-[11px]",
                confirmingDelete
                  ? "font-semibold text-kr8-danger"
                  : "text-kr8-fg-muted hover:text-kr8-danger",
              )}
              onClick={() => {
                if (confirmingDelete) {
                  onDelete(message.publicId);
                  setConfirmingDelete(false);
                } else {
                  setConfirmingDelete(true);
                }
              }}
            >
              {confirmingDelete ? "Confirm?" : "Delete"}
            </button>
          )}
        </div>
        {editing ? (
          <div className="mt-1 space-y-1.5">
            <textarea
              value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
              rows={3}
              className="w-full rounded-kr8-sm border border-kr8-border bg-kr8-bg px-2 py-1.5 text-sm outline-none focus:border-kr8-accent"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={!editDraft.trim()}
                onClick={() => {
                  onEdit?.(message.publicId, editDraft.trim());
                  setEditing(false);
                }}
              >
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <p className="whitespace-pre-wrap text-sm">{message.body}</p>
        )}
        <ReactionBar
          message={message}
          userId={userId}
          onToggle={onToggleReaction}
        />
        {isGate && onRejectGate && (
          <div className="mt-1">
            {rejectOpen ? (
              <div className="flex gap-1">
                <input
                  autoFocus
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      onRejectGate(message.publicId, reason.trim());
                      setRejectOpen(false);
                      setReason("");
                    }
                    if (e.key === "Escape") setRejectOpen(false);
                  }}
                  placeholder="Why reject? (Enter to send)"
                  className="flex-1 rounded-kr8-sm border border-kr8-border bg-kr8-bg px-2 py-1 text-[12px] outline-none focus:border-kr8-accent"
                />
              </div>
            ) : (
              <button
                className="text-[11px] text-kr8-fg-muted hover:text-kr8-danger"
                onClick={() => setRejectOpen(true)}
              >
                Reject with reason…
              </button>
            )}
          </div>
        )}
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
  const { user, activeWorkspace } = useWorkspace();
  const isAdmin = activeWorkspace?.role === "admin";
  const utils = api.useUtils();
  const [draft, setDraft] = useState("");
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [threadDraft, setThreadDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  // Per-channel unread watermark (see /channels index) — visiting marks read.
  const [seenMap, setSeenMap] = useLocalStorage<Record<string, string>>(
    "kr8kan.channelSeen",
    {},
  );

  // SSE live updates; the poll stays as the honest fallback and relaxes
  // to 60s while the stream is healthy.
  const live = useLiveEvents(activeWorkspace?.publicId, (event) => {
    if (event.channelPublicId !== channelPublicId) return;
    void utils.channel.messages.invalidate({ channelPublicId });
    if (openThread) void utils.channel.thread.invalidate();
  });
  const pollMs = live ? 60_000 : 30_000;

  const channel = api.channel.byPublicId.useQuery(
    { channelPublicId },
    { enabled: channelPublicId.length === 12 },
  );
  const messages = api.channel.messages.useQuery(
    { channelPublicId },
    { enabled: channelPublicId.length === 12, refetchInterval: pollMs },
  );
  const thread = api.channel.thread.useQuery(
    { messagePublicId: openThread ?? "" },
    { enabled: Boolean(openThread), refetchInterval: pollMs },
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
  const [confirmingDeleteChannel, setConfirmingDeleteChannel] = useState(false);
  const deleteChannel = api.channel.delete.useMutation({
    onSuccess: () => {
      toast("Channel moved to trash", "success");
      void utils.channel.list.invalidate();
      void router.push("/channels");
    },
    onError: (err) => toast(err.message, "error"),
  });

  // Optimistic reactions: patch both message caches immediately, refetch
  // on settle — reactions are a control surface (gates/proposals) and
  // must feel instant.
  const patchReactions = (
    messagePublicId: string,
    mutate: (reactions: MessageReaction[]) => MessageReaction[],
  ) => {
    const patchList = <T extends { publicId: string; reactions?: MessageReaction[] }>(
      rows: T[],
    ) =>
      rows.map((m) =>
        m.publicId === messagePublicId
          ? { ...m, reactions: mutate(m.reactions ?? []) }
          : m,
      );
    utils.channel.messages.setData(
      { channelPublicId },
      (data: { messages?: MessageItem[] } | undefined) =>
        data?.messages
          ? { ...data, messages: patchList(data.messages) }
          : data,
    );
    if (openThread) {
      utils.channel.thread.setData(
        { messagePublicId: openThread },
        (data: { replies?: MessageItem[] } | undefined) =>
          data?.replies ? { ...data, replies: patchList(data.replies) } : data,
      );
    }
  };
  const settleReactions = () => {
    void utils.channel.messages.invalidate();
    void utils.channel.thread.invalidate();
  };
  const addReaction = api.channel.addReaction.useMutation({
    onMutate: (input) => {
      if (user?.id) {
        patchReactions(input.messagePublicId, (reactions) =>
          reactions.some((r) => r.emoji === input.emoji && r.userId === user.id)
            ? reactions
            : [...reactions, { emoji: input.emoji, userId: user.id }],
        );
      }
    },
    onSettled: settleReactions,
    onError: (err) => toast(err.message, "error"),
  });
  const removeReaction = api.channel.removeReaction.useMutation({
    onMutate: (input) => {
      if (user?.id) {
        patchReactions(input.messagePublicId, (reactions) =>
          reactions.filter(
            (r) => !(r.emoji === input.emoji && r.userId === user.id),
          ),
        );
      }
    },
    onSettled: settleReactions,
    onError: (err) => toast(err.message, "error"),
  });
  const updateMessage = api.channel.updateMessage.useMutation({
    onSuccess: () => {
      void utils.channel.messages.invalidate();
      void utils.channel.thread.invalidate();
    },
    onError: (err) => toast(err.message, "error"),
  });
  const deleteMessage = api.channel.deleteMessage.useMutation({
    onSuccess: () => {
      void utils.channel.messages.invalidate();
      void utils.channel.thread.invalidate();
    },
    onError: (err) => toast(err.message, "error"),
  });
  const rejectGate = api.workflow.rejectGate.useMutation({
    onSuccess: () => {
      toast("Gate rejected", "success");
      settleReactions();
    },
    onError: (err) => toast(err.message, "error"),
  });
  const toggleReaction = (
    messagePublicId: string,
    emoji: string,
    reacted: boolean,
  ) => {
    const typedEmoji = emoji as (typeof REACTION_EMOJI)[number];
    if (reacted) removeReaction.mutate({ messagePublicId, emoji: typedEmoji });
    else addReaction.mutate({ messagePublicId, emoji: typedEmoji });
  };
  const rejectGateWithReason = (messagePublicId: string, reason: string) =>
    rejectGate.mutate({ messagePublicId, reason });

  const items = ((messages.data as { messages?: MessageItem[] } | undefined)
    ?.messages ?? []) as MessageItem[];

  // Deep link (?message=… [&thread=…]): scroll the hit into view with a
  // brief highlight — same pattern as comment hits opening cards. When
  // the hit is a thread reply, open its thread first.
  const targetMessage =
    typeof router.query.message === "string" ? router.query.message : null;
  const targetThread =
    typeof router.query.thread === "string" ? router.query.thread : null;
  const [highlighted, setHighlighted] = useState<string | null>(null);
  useEffect(() => {
    if (!targetMessage || messages.isLoading) return;
    if (targetThread) setOpenThread(targetThread);
    const timer = setTimeout(() => {
      const el = document.getElementById(`message-${targetMessage}`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlighted(targetMessage);
      setTimeout(() => setHighlighted(null), 2500);
    }, 150);
    return () => clearTimeout(timer);
  }, [targetMessage, targetThread, messages.isLoading]);

  useEffect(() => {
    if (targetMessage) return; // deep link wins over scroll-to-bottom
    bottomRef.current?.scrollIntoView();
  }, [items.length, targetMessage]);

  // Mark the channel read: on entry and as new messages arrive while open.
  useEffect(() => {
    if (channelPublicId.length !== 12 || items.length === 0) return;
    setSeenMap({ ...seenMap, [channelPublicId]: new Date().toISOString() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelPublicId, items.length]);

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
            <button
              title="Delete channel (restorable from Trash)"
              className={clsx(
                "text-[12px]",
                confirmingDeleteChannel
                  ? "font-semibold text-kr8-danger"
                  : "text-kr8-fg-muted hover:text-kr8-danger",
              )}
              onClick={() => {
                if (confirmingDeleteChannel) {
                  deleteChannel.mutate({ channelPublicId });
                } else {
                  setConfirmingDeleteChannel(true);
                  setTimeout(() => setConfirmingDeleteChannel(false), 3000);
                }
              }}
            >
              {confirmingDeleteChannel ? "Confirm?" : <HiOutlineTrash className="h-4 w-4" />}
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
                userId={user?.id}
                isAdmin={isAdmin}
                highlighted={highlighted === m.publicId}
                onToggleReaction={toggleReaction}
                onRejectGate={rejectGateWithReason}
                onEdit={(messagePublicId, body) =>
                  updateMessage.mutate({ messagePublicId, body })
                }
                onDelete={(messagePublicId) =>
                  deleteMessage.mutate({ messagePublicId })
                }
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
              {rootOfThread && (
                <MessageRow
                  message={rootOfThread}
                  userId={user?.id}
                  isAdmin={isAdmin}
                  highlighted={highlighted === rootOfThread.publicId}
                  onToggleReaction={toggleReaction}
                  onRejectGate={rejectGateWithReason}
                  onEdit={(messagePublicId, body) =>
                    updateMessage.mutate({ messagePublicId, body })
                  }
                  onDelete={(messagePublicId) =>
                    deleteMessage.mutate({ messagePublicId })
                  }
                />
              )}
              {(
                ((thread.data as { replies?: MessageItem[] } | undefined)
                  ?.replies ?? []) as MessageItem[]
              ).map((m) => (
                <MessageRow
                  key={m.publicId}
                  message={m}
                  inThread
                  userId={user?.id}
                  isAdmin={isAdmin}
                  highlighted={highlighted === m.publicId}
                  onToggleReaction={toggleReaction}
                  onRejectGate={rejectGateWithReason}
                  onEdit={(messagePublicId, body) =>
                    updateMessage.mutate({ messagePublicId, body })
                  }
                  onDelete={(messagePublicId) =>
                    deleteMessage.mutate({ messagePublicId })
                  }
                />
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
