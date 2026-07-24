import type { ReactNode } from "react";
import { Fragment, useEffect, useState } from "react";
import { useRouter } from "next/router";
import {
  Dialog,
  DialogPanel,
  Disclosure,
  DisclosureButton,
  DisclosurePanel,
  Transition,
  TransitionChild,
} from "@headlessui/react";
import clsx from "clsx";
import {
  HiChevronDown,
  HiOutlineArrowsRightLeft,
  HiOutlineSparkles,
  HiOutlineTrash,
  HiPlus,
  HiXMark,
} from "react-icons/hi2";

import { AgentAvatar, AgentChip } from "~/components/AgentAvatar";
import { Avatar } from "~/components/Avatar";
import { Badge } from "~/components/Badge";
import { Button } from "~/components/Button";
import { Dropdown } from "~/components/Dropdown";
import { Editor } from "~/components/Editor";
import { Input } from "~/components/Input";
import { MobileSheet } from "~/components/MobileSheet";
import { ProgressBar } from "~/components/ProgressBar";
import { WorkerRunner } from "~/components/WorkerRunner";
import { useIsMobile } from "~/hooks/useIsMobile";
import { useToast } from "~/providers/toast";
import { useWorkspace } from "~/providers/workspace";
import { api } from "~/utils/api";
import { formatDateTime, isOverdue, relativeTime } from "~/utils/format";

const LABEL_COLOURS = [
  "#0f6b5c",
  "#b42318",
  "#b54708",
  "#067647",
  "#175cd3",
  "#6941c6",
  "#c11574",
];

export interface CardDetailProps {
  cardPublicId: string;
  boardPublicId: string;
  workspacePublicId: string;
  lists: { publicId: string; name: string }[];
  onClose: () => void;
}

/**
 * Card detail — right drawer on desktop (board context stays visible),
 * full-screen sheet on mobile with accordion sections. All actions are
 * touch-reachable; "Move" is the explicit DnD fallback.
 */
export function CardDetail(props: CardDetailProps) {
  const isMobile = useIsMobile();
  const body = <CardDetailBody {...props} />;

  if (isMobile) {
    return (
      <MobileSheet open onClose={props.onClose} title="Card" height="full">
        {body}
      </MobileSheet>
    );
  }
  return (
    <Transition show as={Fragment} appear>
      <Dialog onClose={props.onClose} className="relative z-50">
        <TransitionChild
          as={Fragment}
          enter="ease-out duration-150"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-100"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/30" aria-hidden />
        </TransitionChild>
        <div className="fixed inset-y-0 right-0 flex max-w-full">
          <TransitionChild
            as={Fragment}
            enter="duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]"
            enterFrom="translate-x-full"
            enterTo="translate-x-0"
            leave="duration-150 ease-in"
            leaveFrom="translate-x-0"
            leaveTo="translate-x-full"
          >
            <DialogPanel
              as="aside"
              aria-label="Card details"
              className="w-screen max-w-[460px] overflow-y-auto border-l border-kr8-border bg-kr8-bg-elevated p-5 shadow-kr8-md"
            >
              <div className="mb-3 flex justify-end">
                <button
                  onClick={props.onClose}
                  aria-label="Close card"
                  className="rounded-kr8-sm p-1.5 text-kr8-fg-muted hover:bg-kr8-bg-muted hover:text-kr8-fg"
                >
                  <HiXMark className="h-5 w-5" />
                </button>
              </div>
              {body}
            </DialogPanel>
          </TransitionChild>
        </div>
      </Dialog>
    </Transition>
  );
}

function CardDetailBody({
  cardPublicId,
  boardPublicId,
  workspacePublicId,
  lists,
  onClose,
}: CardDetailProps) {
  const { toast } = useToast();
  const { user, activeWorkspace } = useWorkspace();
  const activeRole = activeWorkspace?.role;
  const utils = api.useUtils();
  const [workerOpen, setWorkerOpen] = useState(false);

  const card = api.card.byPublicId.useQuery({ cardPublicId });
  const labels = api.label.list.useQuery({ boardPublicId });
  const members = api.member.list.useQuery({ workspacePublicId });

  const refresh = () => {
    void utils.card.byPublicId.invalidate({ cardPublicId });
    void utils.board.byPublicId.invalidate({ boardPublicId });
  };

  const updateCard = api.card.update.useMutation({ onSettled: refresh });
  const moveCard = api.card.move.useMutation({ onSettled: refresh });
  const deleteCard = api.card.delete.useMutation({
    onSuccess: () => {
      toast("Card deleted", "success");
      onClose();
    },
  });
  const addLabel = api.card.addLabel.useMutation({ onSettled: refresh });
  const removeLabel = api.card.removeLabel.useMutation({ onSettled: refresh });
  const createLabel = api.label.create.useMutation({
    onSuccess: () => void utils.label.list.invalidate({ boardPublicId }),
  });
  const addMember = api.card.addMember.useMutation({ onSettled: refresh });
  const removeMember = api.card.removeMember.useMutation({ onSettled: refresh });
  const addComment = api.card.addComment.useMutation({
    onSettled: refresh,
    onSuccess: (result: {
      mentions?: {
        dispatched: { worker: string }[];
        skipped: { worker: string; reason: string }[];
      };
    }) => {
      for (const d of result?.mentions?.dispatched ?? []) {
        toast(`@${d.worker} is on it — reply lands in this thread`, "success");
      }
      for (const s of result?.mentions?.skipped ?? []) {
        toast(`@${s.worker}: ${s.reason}`, "error");
      }
    },
  });
  // Optimistic reactions: patch the cached card immediately, roll back on
  // error — reactions are a control surface (gates/proposals) and must
  // feel instant.
  type CachedReaction = {
    emoji: string;
    userId: string;
    user?: { name?: string } | null;
  };
  const patchReactions = (
    commentPublicId: string,
    mutate: (reactions: CachedReaction[]) => CachedReaction[],
  ) => {
    utils.card.byPublicId.setData({ cardPublicId }, (prev: any) => {
      if (!prev) return prev;
      return {
        ...prev,
        comments: (prev.comments ?? []).map((c: any) =>
          c.publicId === commentPublicId
            ? { ...c, reactions: mutate(c.reactions ?? []) }
            : c,
        ),
      };
    });
  };
  const addReaction = api.card.addReaction.useMutation({
    onMutate: async (input: { commentPublicId: string; emoji: string }) => {
      await utils.card.byPublicId.cancel({ cardPublicId });
      const snapshot = utils.card.byPublicId.getData({ cardPublicId });
      if (user) {
        patchReactions(input.commentPublicId, (reactions) =>
          reactions.some((r) => r.emoji === input.emoji && r.userId === user.id)
            ? reactions
            : [
                ...reactions,
                { emoji: input.emoji, userId: user.id, user: { name: user.name } },
              ],
        );
      }
      return { snapshot };
    },
    onError: (err, _input, context) => {
      if (context?.snapshot) {
        utils.card.byPublicId.setData({ cardPublicId }, context.snapshot);
      }
      toast(err.message, "error");
    },
    onSuccess: (r: { gateHandled?: boolean; proposalApplied?: boolean }) => {
      if (r?.gateHandled) toast("Gate resolved", "success");
      if (r?.proposalApplied) toast("Proposal applied to the board", "success");
    },
    onSettled: refresh,
  });
  const removeReaction = api.card.removeReaction.useMutation({
    onMutate: async (input: { commentPublicId: string; emoji: string }) => {
      await utils.card.byPublicId.cancel({ cardPublicId });
      const snapshot = utils.card.byPublicId.getData({ cardPublicId });
      if (user) {
        patchReactions(input.commentPublicId, (reactions) =>
          reactions.filter(
            (r) => !(r.emoji === input.emoji && r.userId === user.id),
          ),
        );
      }
      return { snapshot };
    },
    onError: (_err, _input, context) => {
      if (context?.snapshot) {
        utils.card.byPublicId.setData({ cardPublicId }, context.snapshot);
      }
    },
    onSettled: refresh,
  });
  const updateComment = api.card.updateComment.useMutation({
    onSettled: refresh,
    onSuccess: () => setEditingComment(null),
    onError: (err) => toast(err.message, "error"),
  });
  const deleteComment = api.card.deleteComment.useMutation({
    onSettled: refresh,
    onError: (err) => toast(err.message, "error"),
  });
  const createChecklist = api.checklist.create.useMutation({ onSettled: refresh });
  const addItem = api.checklist.addItem.useMutation({ onSettled: refresh });
  const updateItem = api.checklist.updateItem.useMutation({ onSettled: refresh });
  const deleteChecklist = api.checklist.delete.useMutation({ onSettled: refresh });
  const storage = api.attachment.storageStatus.useQuery();
  const presign = api.attachment.presign.useMutation();
  const getAttachmentUrl = api.attachment.getUrl.useMutation();
  const deleteAttachment = api.attachment.delete.useMutation({
    onSettled: refresh,
    onError: (err) => toast(err.message, "error"),
  });
  const [uploading, setUploading] = useState(false);
  const [confirmingDeleteAttachment, setConfirmingDeleteAttachment] = useState<
    string | null
  >(null);

  const uploadFile = async (file: File) => {
    setUploading(true);
    try {
      const { attachmentPublicId, uploadUrl } = await presign.mutateAsync({
        cardPublicId,
        filename: file.name,
        contentType: file.type || undefined,
        size: file.size,
      });
      const put = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "content-type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!put.ok) throw new Error(`upload failed (HTTP ${put.status})`);
      void attachmentPublicId;
      toast("Attachment uploaded", "success");
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "upload failed", "error");
    } finally {
      setUploading(false);
    }
  };

  const openAttachment = async (attachmentPublicId: string) => {
    try {
      const { url } = await getAttachmentUrl.mutateAsync({ attachmentPublicId });
      window.open(url, "_blank", "noopener");
    } catch (err) {
      toast(err instanceof Error ? err.message : "could not open", "error");
    }
  };

  const [comment, setComment] = useState("");
  const [editingComment, setEditingComment] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [confirmingDeleteComment, setConfirmingDeleteComment] = useState<
    string | null
  >(null);
  // Search deep link (?comment=…): scroll the matched comment into view
  // with a brief highlight once the card payload has rendered.
  const router = useRouter();
  const targetComment =
    typeof router.query.comment === "string" ? router.query.comment : null;
  const [highlighted, setHighlighted] = useState<string | null>(null);
  useEffect(() => {
    if (!targetComment || card.isLoading) return;
    const el = document.getElementById(`comment-${targetComment}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlighted(targetComment);
    const timer = setTimeout(() => setHighlighted(null), 2500);
    return () => clearTimeout(timer);
  }, [targetComment, card.isLoading]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const workers = api.agent.listWorkers.useQuery(undefined, {
    enabled: mentionOpen,
  });
  const customWorkers = api.agent.listCustomWorkers.useQuery(
    { workspacePublicId },
    { enabled: mentionOpen && Boolean(workspacePublicId) },
  );
  const [newChecklist, setNewChecklist] = useState("");
  const [itemDrafts, setItemDrafts] = useState<Record<string, string>>({});

  if (card.isLoading || !card.data) {
    return <p className="p-4 text-sm text-kr8-fg-muted">Loading card…</p>;
  }
  const data = card.data;
  const cardLabelIds = new Set(
    (data.labels ?? []).map(
      (l: { label: { publicId: string } }) => l.label.publicId,
    ),
  );
  const cardMemberIds = new Set(
    (data.members ?? []).map(
      (m: { member: { publicId: string } }) => m.member.publicId,
    ),
  );
  const allItems = (data.checklists ?? []).flatMap(
    (c: { items: { completed: boolean }[] }) => c.items,
  );
  const doneItems = allItems.filter((i: { completed: boolean }) => i.completed);

  return (
    <div className="space-y-5 pb-6">
      {/* Title + meta */}
      <div>
        <InlineTitle
          title={data.title}
          onSave={(title) => updateCard.mutate({ cardPublicId, title })}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-kr8-fg-muted">
          <span>
            in <strong className="text-kr8-fg">{data.list?.name}</strong>
          </span>
          <span className="font-mono text-[11px]">{data.publicId}</span>
        </div>
        {allItems.length > 0 && (
          <div className="mt-3">
            <ProgressBar value={doneItems.length} max={allItems.length} />
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-2">
        <Dropdown
          align="left"
          buttonLabel="Move card to list"
          button={
            <span className="flex items-center gap-1.5 rounded-kr8-sm border border-kr8-border px-3 py-2 text-[13px] font-medium">
              <HiOutlineArrowsRightLeft className="h-4 w-4" /> Move
            </span>
          }
          items={lists.map((list) => ({
            label: list.name,
            onClick: () =>
              moveCard.mutate({
                cardPublicId,
                toListPublicId: list.publicId,
                position: 9999,
              }),
          }))}
        />
        <Button
          size="sm"
          variant="secondary"
          iconLeft={<HiOutlineSparkles className="h-4 w-4 text-kr8-accent" />}
          onClick={() => setWorkerOpen(true)}
        >
          AI worker
        </Button>
        <div className="flex-1" />
        <Button
          size="sm"
          variant="ghost"
          className="text-kr8-danger"
          iconLeft={<HiOutlineTrash className="h-4 w-4" />}
          onClick={() => deleteCard.mutate({ cardPublicId })}
        >
          Delete
        </Button>
      </div>

      {/* Due date */}
      <label className="block">
        <span className="mb-1.5 block text-[13px] font-medium">Due date</span>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={
              data.dueDate
                ? new Date(data.dueDate).toISOString().slice(0, 10)
                : ""
            }
            onChange={(e) =>
              updateCard.mutate({
                cardPublicId,
                dueDate: e.target.value ? new Date(e.target.value) : null,
              })
            }
            className="rounded-kr8-sm border border-kr8-border bg-kr8-bg-elevated px-3 py-2 text-sm"
          />
          {data.dueDate && isOverdue(data.dueDate) && (
            <Badge tone="danger">overdue</Badge>
          )}
        </div>
      </label>

      {/* Labels */}
      <Section title="Labels">
        <div className="flex flex-wrap gap-1.5">
          {(labels.data ?? []).map((label) => {
            const active = cardLabelIds.has(label.publicId);
            return (
              <button
                key={label.publicId}
                onClick={() =>
                  active
                    ? removeLabel.mutate({
                        cardPublicId,
                        labelPublicId: label.publicId,
                      })
                    : addLabel.mutate({
                        cardPublicId,
                        labelPublicId: label.publicId,
                      })
                }
                className={clsx(
                  "min-h-[36px] rounded-full border px-3 py-1 text-[12px] font-medium transition-colors",
                  active ? "border-transparent" : "border-kr8-border opacity-60",
                )}
                style={{
                  backgroundColor: active
                    ? `${label.colourCode}26`
                    : undefined,
                  color: label.colourCode,
                }}
              >
                {label.name}
              </button>
            );
          })}
          <button
            onClick={() => {
              const name = window.prompt("Label name?");
              if (name?.trim()) {
                createLabel.mutate({
                  boardPublicId,
                  name: name.trim(),
                  colourCode:
                    LABEL_COLOURS[
                      (labels.data?.length ?? 0) % LABEL_COLOURS.length
                    ]!,
                });
              }
            }}
            className="flex min-h-[36px] items-center gap-1 rounded-full border border-dashed border-kr8-border px-3 py-1 text-[12px] text-kr8-fg-muted hover:text-kr8-fg"
          >
            <HiPlus className="h-3.5 w-3.5" /> New label
          </button>
        </div>
      </Section>

      {/* Members */}
      <Section title="Members">
        <div className="flex flex-wrap gap-1.5">
          {(members.data ?? []).map(
            (member: {
              publicId: string;
              user: { name: string; email: string; image?: string | null };
            }) => {
              const active = cardMemberIds.has(member.publicId);
              return (
                <button
                  key={member.publicId}
                  onClick={() =>
                    active
                      ? removeMember.mutate({
                          cardPublicId,
                          memberPublicId: member.publicId,
                        })
                      : addMember.mutate({
                          cardPublicId,
                          memberPublicId: member.publicId,
                        })
                  }
                  className={clsx(
                    "flex min-h-[36px] items-center gap-1.5 rounded-full border px-2 py-1 text-[12px]",
                    active
                      ? "border-kr8-accent bg-kr8-accent/10 text-kr8-fg"
                      : "border-kr8-border text-kr8-fg-muted",
                  )}
                >
                  <Avatar
                    name={member.user.name || member.user.email}
                    image={member.user.image}
                    size="xs"
                  />
                  {member.user.name || member.user.email}
                </button>
              );
            },
          )}
        </div>
      </Section>

      {/* Description */}
      <Section title="Description" defaultOpen>
        <Editor
          content={data.description ?? ""}
          onBlur={(html) =>
            updateCard.mutate({ cardPublicId, description: html })
          }
        />
      </Section>

      {/* Checklists */}
      <Section title={`Checklists${allItems.length ? ` · ${doneItems.length}/${allItems.length}` : ""}`} defaultOpen={allItems.length > 0}>
        <div className="space-y-4">
          {(data.checklists ?? []).map(
            (checklist: {
              publicId: string;
              name: string;
              items: {
                publicId: string;
                title: string;
                completed: boolean;
              }[];
            }) => (
              <div key={checklist.publicId}>
                <div className="mb-1.5 flex items-center justify-between">
                  <h4 className="text-[13px] font-semibold">{checklist.name}</h4>
                  <button
                    aria-label={`Delete checklist ${checklist.name}`}
                    onClick={() =>
                      deleteChecklist.mutate({
                        checklistPublicId: checklist.publicId,
                      })
                    }
                    className="text-kr8-fg-muted hover:text-kr8-danger"
                  >
                    <HiOutlineTrash className="h-4 w-4" />
                  </button>
                </div>
                <ul className="space-y-1">
                  {checklist.items.map((item) => (
                    <li key={item.publicId}>
                      <label className="flex min-h-[36px] cursor-pointer items-center gap-2 rounded-kr8-sm px-1 py-1 text-sm hover:bg-kr8-bg-muted">
                        <input
                          type="checkbox"
                          checked={item.completed}
                          onChange={(e) =>
                            updateItem.mutate({
                              itemPublicId: item.publicId,
                              completed: e.target.checked,
                            })
                          }
                          className="h-4 w-4 accent-[rgb(var(--kr8-accent))]"
                        />
                        <span
                          className={clsx(
                            item.completed &&
                              "text-kr8-fg-muted line-through",
                          )}
                        >
                          {item.title}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const draft = itemDrafts[checklist.publicId]?.trim();
                    if (draft) {
                      addItem.mutate({
                        checklistPublicId: checklist.publicId,
                        title: draft,
                      });
                      setItemDrafts((d) => ({ ...d, [checklist.publicId]: "" }));
                    }
                  }}
                  className="mt-1"
                >
                  <input
                    value={itemDrafts[checklist.publicId] ?? ""}
                    onChange={(e) =>
                      setItemDrafts((d) => ({
                        ...d,
                        [checklist.publicId]: e.target.value,
                      }))
                    }
                    placeholder="Add item…"
                    className="w-full rounded-kr8-sm border border-transparent bg-transparent px-1 py-1.5 text-sm outline-none placeholder:text-kr8-fg-muted focus:border-kr8-border"
                  />
                </form>
              </div>
            ),
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (newChecklist.trim()) {
                createChecklist.mutate({
                  cardPublicId,
                  name: newChecklist.trim(),
                });
                setNewChecklist("");
              }
            }}
          >
            <Input
              placeholder="New checklist name…"
              value={newChecklist}
              onChange={(e) => setNewChecklist(e.target.value)}
            />
          </form>
        </div>
      </Section>

      {/* Attachments */}
      <Section
        title={`Attachments${data.attachments?.length ? ` · ${data.attachments.length}` : ""}`}
      >
        <div className="space-y-2">
          {((data.attachments ?? []) as {
            publicId: string;
            filename: string;
            size: number | null;
            createdAt: string | Date;
            deletedAt?: string | Date | null;
          }[])
            .filter((a) => !a.deletedAt)
            .map((attachment) => (
              <div
                key={attachment.publicId}
                className="flex min-h-[44px] items-center gap-2 rounded-kr8-sm border border-kr8-border bg-kr8-bg-elevated px-3"
              >
                <button
                  onClick={() => void openAttachment(attachment.publicId)}
                  className="min-w-0 flex-1 truncate text-left text-sm hover:text-kr8-accent"
                >
                  {attachment.filename}
                </button>
                <span className="text-[11px] text-kr8-fg-muted">
                  {attachment.size
                    ? `${(attachment.size / 1024).toFixed(0)} KB · `
                    : ""}
                  {relativeTime(attachment.createdAt)}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-kr8-danger"
                  onClick={() => {
                    if (confirmingDeleteAttachment === attachment.publicId) {
                      deleteAttachment.mutate({
                        attachmentPublicId: attachment.publicId,
                      });
                      setConfirmingDeleteAttachment(null);
                    } else {
                      setConfirmingDeleteAttachment(attachment.publicId);
                    }
                  }}
                >
                  {confirmingDeleteAttachment === attachment.publicId
                    ? "Confirm?"
                    : "Delete"}
                </Button>
              </div>
            ))}
          {storage.data?.configured ? (
            <label className="block">
              <input
                type="file"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadFile(file);
                  e.target.value = "";
                }}
              />
              <span
                className={clsx(
                  "inline-flex min-h-[44px] cursor-pointer items-center rounded-kr8-sm border border-dashed border-kr8-border px-3 text-[13px] text-kr8-fg-muted hover:border-kr8-accent hover:text-kr8-fg",
                  uploading && "pointer-events-none opacity-50",
                )}
              >
                {uploading ? "Uploading…" : "+ Upload a file (max 25 MB)"}
              </span>
            </label>
          ) : (
            <p className="text-[12px] text-kr8-fg-muted">
              Attachment storage is not configured — set S3_ENDPOINT, S3_BUCKET,
              S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY to enable uploads.
            </p>
          )}
        </div>
      </Section>

      {/* Comments */}
      <Section title={`Comments${data.comments?.length ? ` · ${data.comments.length}` : ""}`} defaultOpen>
        <div className="space-y-3">
          {(data.comments ?? []).map(
            (item: {
              publicId: string;
              comment: string;
              createdAt: string | Date;
              author: { id: string; name: string; image?: string | null } | null;
              agent?: {
                publicId: string;
                displayName: string;
                avatar: string;
              } | null;
              reactions?: {
                emoji: string;
                userId: string;
                user?: { name?: string } | null;
              }[];
            }) => {
              const isGate = Boolean(item.agent) && item.comment.includes("`wfrun:");
              const isProposal =
                Boolean(item.agent) && /`job:[a-z0-9]+`/.test(item.comment);
              const reactionGroups = new Map<string, string[]>();
              for (const r of item.reactions ?? []) {
                const names = reactionGroups.get(r.emoji) ?? [];
                names.push(r.user?.name ?? "someone");
                reactionGroups.set(r.emoji, names);
              }
              return (
                <div
                  key={item.publicId}
                  id={`comment-${item.publicId}`}
                  className={clsx(
                    "flex gap-2.5 rounded-kr8-sm transition-shadow duration-500",
                    highlighted === item.publicId &&
                      "ring-2 ring-kr8-accent ring-offset-2 ring-offset-kr8-bg",
                  )}
                >
                  {item.agent ? (
                    <AgentAvatar agent={item.agent} />
                  ) : (
                    <Avatar name={item.author?.name ?? "?"} image={item.author?.image} />
                  )}
                  <div
                    className={clsx(
                      "min-w-0 flex-1 rounded-kr8-sm px-3 py-2",
                      isGate
                        ? "border border-kr8-accent/50 bg-kr8-accent/5"
                        : "bg-kr8-bg-muted",
                    )}
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="text-[13px] font-semibold">
                        {item.agent?.displayName ?? item.author?.name ?? "Unknown"}
                      </span>
                      {item.agent && <AgentChip />}
                      {item.agent && item.author?.name && (
                        <span
                          className="text-[11px] text-kr8-fg-muted"
                          title={`operated by ${item.author.name}`}
                        >
                          via {item.author.name}
                        </span>
                      )}
                      <span className="text-[11px] text-kr8-fg-muted">
                        {relativeTime(item.createdAt)}
                      </span>
                      <span className="flex-1" />
                      {!item.agent && item.author?.id === user?.id && (
                        <button
                          className="text-[11px] text-kr8-fg-muted hover:text-kr8-fg"
                          onClick={() => {
                            setEditingComment(item.publicId);
                            setEditDraft(item.comment);
                            setConfirmingDeleteComment(null);
                          }}
                        >
                          Edit
                        </button>
                      )}
                      {(item.author?.id === user?.id ||
                        activeRole === "admin") && (
                        <button
                          className={clsx(
                            "text-[11px]",
                            confirmingDeleteComment === item.publicId
                              ? "font-semibold text-kr8-danger"
                              : "text-kr8-fg-muted hover:text-kr8-danger",
                          )}
                          onClick={() => {
                            if (confirmingDeleteComment === item.publicId) {
                              deleteComment.mutate({
                                commentPublicId: item.publicId,
                              });
                              setConfirmingDeleteComment(null);
                            } else {
                              setConfirmingDeleteComment(item.publicId);
                            }
                          }}
                        >
                          {confirmingDeleteComment === item.publicId
                            ? "Confirm?"
                            : "Delete"}
                        </button>
                      )}
                    </div>
                    {editingComment === item.publicId ? (
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
                            loading={updateComment.isPending}
                            disabled={!editDraft.trim()}
                            onClick={() =>
                              updateComment.mutate({
                                commentPublicId: item.publicId,
                                comment: editDraft.trim(),
                              })
                            }
                          >
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditingComment(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap text-sm">{item.comment}</p>
                    )}
                    {(isGate || isProposal) && (
                      <p className="mt-1 text-[11px] text-kr8-accent">
                        React 👍 to approve{isGate ? " · ❌ to reject" : " and apply"}
                      </p>
                    )}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      {[...reactionGroups.entries()].map(([emoji, names]) => (
                        <button
                          key={emoji}
                          title={names.join(", ")}
                          onClick={() =>
                            removeReaction.mutate({
                              commentPublicId: item.publicId,
                              emoji: emoji as "👍",
                            })
                          }
                          className="min-h-[28px] rounded-full border border-kr8-border bg-kr8-bg-elevated px-2 text-[12px] hover:border-kr8-accent"
                        >
                          {emoji} {names.length}
                        </button>
                      ))}
                      {["👍", "🎉", "👀", "❌"].map((emoji) => (
                        <button
                          key={emoji}
                          aria-label={`react ${emoji}`}
                          onClick={() =>
                            addReaction.mutate({
                              commentPublicId: item.publicId,
                              emoji: emoji as "👍",
                            })
                          }
                          className="min-h-[28px] rounded-full px-1.5 text-[12px] opacity-40 transition-opacity hover:opacity-100"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            },
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (comment.trim()) {
                addComment.mutate({ cardPublicId, comment: comment.trim() });
                setComment("");
              }
            }}
            className="flex gap-2"
          >
            <div className="relative flex-1">
              {mentionOpen && (
                <div className="absolute bottom-full left-0 z-10 mb-1 max-h-56 w-full overflow-y-auto rounded-kr8-md border border-kr8-border bg-kr8-bg-elevated shadow-lg">
                  {[
                    ...((workers.data?.workers as
                      | { name: string; title: string; description: string }[]
                      | undefined) ?? []),
                    ...((customWorkers.data as
                      | { name: string; title: string; description?: string | null }[]
                      | undefined) ?? []),
                  ]
                    .filter((w) => {
                      const at = comment.lastIndexOf("@");
                      const frag = at >= 0 ? comment.slice(at + 1).toLowerCase() : "";
                      return w.name.startsWith(frag);
                    })
                    .map((w) => (
                      <button
                        key={w.name}
                        type="button"
                        onClick={() => {
                          const at = comment.lastIndexOf("@");
                          setComment(`${comment.slice(0, at)}@${w.name} `);
                          setMentionOpen(false);
                        }}
                        className="flex min-h-[40px] w-full flex-col justify-center px-3 py-1 text-left hover:bg-kr8-bg-muted"
                      >
                        <span className="text-[13px] font-medium">@{w.name}</span>
                        <span className="truncate text-[11px] text-kr8-fg-muted">
                          {w.description ?? w.title}
                        </span>
                      </button>
                    ))}
                </div>
              )}
              <input
                value={comment}
                onChange={(e) => {
                  setComment(e.target.value);
                  const at = e.target.value.lastIndexOf("@");
                  setMentionOpen(
                    at >= 0 && !e.target.value.slice(at).includes(" "),
                  );
                }}
                placeholder="Write a comment… (@worker runs an agent)"
                className="min-h-[44px] w-full rounded-kr8-sm border border-kr8-border bg-kr8-bg-elevated px-3 text-sm outline-none placeholder:text-kr8-fg-muted focus:border-kr8-accent"
              />
            </div>
            <Button type="submit" size="md" loading={addComment.isPending}>
              Send
            </Button>
          </form>
        </div>
      </Section>

      {/* Activity */}
      <Section title="Activity">
        <ol className="relative ml-2 space-y-3 border-l border-kr8-border pl-4">
          {(data.activities ?? []).map(
            (activity: {
              publicId: string;
              type: string;
              createdAt: string | Date;
              user: { name: string } | null;
              agent?: { displayName: string; avatar: string } | null;
            }) => (
              <li key={activity.publicId} className="relative text-[13px]">
                <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-kr8-accent/60" />
                <span className="font-medium">
                  {activity.agent
                    ? `${activity.agent.avatar} ${activity.agent.displayName}`
                    : (activity.user?.name ?? "Someone")}
                </span>{" "}
                <span className="text-kr8-fg-muted">
                  {describeActivity(activity.type)} ·{" "}
                  {formatDateTime(activity.createdAt)}
                </span>
              </li>
            ),
          )}
          {(data.activities ?? []).length === 0 && (
            <li className="text-[13px] text-kr8-fg-muted">No activity yet.</li>
          )}
        </ol>
      </Section>

      <WorkerRunner
        open={workerOpen}
        onClose={() => setWorkerOpen(false)}
        boardPublicId={boardPublicId}
        cardPublicId={cardPublicId}
      />
    </div>
  );
}

function describeActivity(type: string): string {
  const map: Record<string, string> = {
    "card.created": "created this card",
    "card.moved": "moved this card",
    "card.updated": "updated this card",
    "card.comment.created": "commented",
    "card.label.added": "added a label",
    "card.member.added": "assigned a member",
    "agent.run.started": "started an agent run",
    "agent.run.completed": "finished an agent run",
    "agent.applied": "applied an agent result",
  };
  return map[type] ?? type;
}

function Section({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <Disclosure defaultOpen={defaultOpen}>
      {({ open }) => (
        <div className="rounded-kr8-md border border-kr8-border">
          <DisclosureButton className="flex min-h-[44px] w-full items-center justify-between px-3 py-2 text-left text-[14px] font-semibold">
            {title}
            <HiChevronDown
              className={clsx(
                "h-4 w-4 text-kr8-fg-muted transition-transform",
                open && "rotate-180",
              )}
            />
          </DisclosureButton>
          <DisclosurePanel className="border-t border-kr8-border px-3 py-3">
            {children}
          </DisclosurePanel>
        </div>
      )}
    </Disclosure>
  );
}

function InlineTitle({
  title,
  onSave,
}: {
  title: string;
  onSave: (title: string) => void;
}) {
  const [value, setValue] = useState(title);
  return (
    <textarea
      value={value}
      rows={1}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        if (value.trim() && value !== title) onSave(value.trim());
      }}
      className="w-full resize-none bg-transparent text-[20px] font-semibold leading-tight outline-none focus:rounded-kr8-sm focus:ring-2 focus:ring-kr8-accent/30"
    />
  );
}
