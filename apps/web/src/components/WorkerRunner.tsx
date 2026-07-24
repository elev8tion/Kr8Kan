import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import clsx from "clsx";
import {
  HiCheckCircle,
  HiOutlineClipboard,
  HiOutlineSparkles,
  HiXCircle,
} from "react-icons/hi2";

import type { ApplyAction } from "@kr8kan/agents/apply";
import { buildApplyActions } from "@kr8kan/agents/apply";

import { Button } from "./Button";
import { MobileSheet } from "./MobileSheet";
import { Modal } from "./Modal";
import { Input, Textarea } from "./Input";
import { useIsMobile } from "~/hooks/useIsMobile";
import { useToast } from "~/providers/toast";
import { useWorkspace } from "~/providers/workspace";
import { api } from "~/utils/api";
import { miniMarkdown } from "~/utils/format";

interface WorkerInfo {
  name: string;
  title: string;
  description: string;
  needs: "board" | "card" | "either" | "none";
  allowTools?: boolean;
  custom?: boolean;
}

interface WorkerRunnerProps {
  open: boolean;
  onClose: () => void;
  /** Pre-scoped context: pass from board/card views */
  boardPublicId?: string;
  cardPublicId?: string;
}

const TOOLS_CONFIRM_KEY = "kr8kan.toolsRunConfirmed";

/**
 * "Run AI worker" flow: pick worker → optional prompt → run → live job
 * status (progress + cancel) → parsed result preview with one-click
 * apply / copy / post-as-comment. Bottom sheet on mobile, modal on
 * desktop.
 */
export function WorkerRunner({
  open,
  onClose,
  boardPublicId,
  cardPublicId,
}: WorkerRunnerProps) {
  const isMobile = useIsMobile();
  const router = useRouter();
  const { toast } = useToast();
  const { activeWorkspace } = useWorkspace();
  const utils = api.useUtils();
  const [selected, setSelected] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [toolsConfirm, setToolsConfirm] = useState(false);
  // Editable apply fields (draft-card preset)
  const [editTitle, setEditTitle] = useState<string | null>(null);
  const [editDescription, setEditDescription] = useState<string | null>(null);
  const [editListPublicId, setEditListPublicId] = useState<string | null>(null);
  const [appliedIndexes, setAppliedIndexes] = useState<number[]>([]);

  // Board context can come from the route when not passed explicitly
  const routeBoardId =
    boardPublicId ??
    (typeof router.query.boardPublicId === "string"
      ? router.query.boardPublicId
      : undefined);

  const workers = api.agent.listWorkers.useQuery(undefined, { enabled: open });
  const customWorkers = api.agent.listCustomWorkers.useQuery(
    { workspacePublicId: activeWorkspace?.publicId ?? "" },
    { enabled: open && Boolean(activeWorkspace) },
  );
  const board = api.board.byPublicId.useQuery(
    { boardPublicId: routeBoardId ?? "" },
    { enabled: open && Boolean(routeBoardId) },
  );
  const runMutation = api.agent.run.useMutation({
    onSuccess: (data: { jobId: string }) => setJobId(data.jobId),
    onError: (err) => toast(err.message, "error"),
  });
  const cancelMutation = api.agent.cancel.useMutation({
    onSuccess: () => void job.refetch(),
    onError: (err) => toast(err.message, "error"),
  });
  const applyMutation = api.agent.apply.useMutation({
    onSuccess: (data: { applied: { index: number; entityPublicId?: string }[] }) => {
      setAppliedIndexes((prev) => [...prev, ...data.applied.map((a) => a.index)]);
      toast("Applied to board", "success");
      void utils.board.byPublicId.invalidate();
      void utils.card.invalidate();
    },
    onError: (err) => toast(err.message, "error"),
  });
  const job = api.agent.status.useQuery(
    { jobId: jobId ?? "" },
    {
      enabled: Boolean(jobId),
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status === "completed" ||
          status === "failed" ||
          status === "cancelled"
          ? false
          : 1500;
      },
    },
  );

  useEffect(() => {
    if (!open) {
      setSelected(null);
      setPrompt("");
      setJobId(null);
      setToolsConfirm(false);
      setEditTitle(null);
      setEditDescription(null);
      setEditListPublicId(null);
      setAppliedIndexes([]);
      runMutation.reset();
      applyMutation.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const allWorkers = useMemo<WorkerInfo[]>(() => {
    const stock = (workers.data?.workers as WorkerInfo[] | undefined) ?? [];
    const custom = (
      (customWorkers.data as
        | {
            name: string;
            title: string;
            description?: string | null;
            needs: string;
          }[]
        | undefined) ?? []
    ).map((c) => ({
      name: c.name,
      title: c.title,
      description: c.description ?? "Custom workspace worker",
      needs: c.needs as WorkerInfo["needs"],
      allowTools: false,
      custom: true,
    }));
    return [...stock, ...custom];
  }, [workers.data, customWorkers.data]);

  const selectedWorker = useMemo(
    () => allWorkers.find((w) => w.name === selected),
    [allWorkers, selected],
  );

  const canRun = useMemo(() => {
    if (!selectedWorker) return false;
    if (selectedWorker.needs === "board") return Boolean(routeBoardId);
    if (selectedWorker.needs === "card") return Boolean(cardPublicId);
    return Boolean(routeBoardId ?? cardPublicId);
  }, [selectedWorker, routeBoardId, cardPublicId]);

  const run = () => {
    if (!selected) return;
    // First tools run this session → explicit confirm step.
    if (
      selectedWorker?.allowTools &&
      !toolsConfirm &&
      typeof window !== "undefined" &&
      !window.sessionStorage.getItem(TOOLS_CONFIRM_KEY)
    ) {
      setToolsConfirm(true);
      return;
    }
    if (selectedWorker?.allowTools && typeof window !== "undefined") {
      window.sessionStorage.setItem(TOOLS_CONFIRM_KEY, "1");
    }
    setToolsConfirm(false);
    runMutation.mutate({
      worker: selected,
      boardPublicId: routeBoardId ?? null,
      cardPublicId: cardPublicId ?? null,
      prompt: prompt || null,
    });
  };

  const copyResult = async () => {
    if (job.data?.result) {
      await navigator.clipboard.writeText(job.data.result);
      toast("Result copied", "success");
    }
  };

  const jobDone = job.data?.status === "completed";
  const parsed = jobDone ? job.data?.resultParsed : undefined;
  const parseError = jobDone ? job.data?.parseError : undefined;

  const boardLists = useMemo(
    () =>
      (board.data?.lists ?? []) as { publicId: string; name: string }[],
    [board.data],
  );

  const preset = useMemo(() => {
    if (!jobDone || !job.data) return null;
    if (job.data.worker === "custom") {
      return buildApplyActions("custom", null, {
        boardPublicId: routeBoardId,
        cardPublicId,
        resultRaw: job.data.result,
      });
    }
    if (parsed === undefined || parsed === null) return null;
    return buildApplyActions(job.data.schemaWorker ?? job.data.worker, parsed, {
      boardPublicId: routeBoardId,
      cardPublicId,
      defaultListPublicId: boardLists[0]?.publicId,
      resultRaw: job.data.result,
    });
  }, [jobDone, job.data, parsed, routeBoardId, cardPublicId, boardLists]);

  const isDraftCard =
    (job.data?.schemaWorker ?? job.data?.worker) === "draft-card" && preset;
  const draftAction = isDraftCard
    ? (preset.actions[0] as Extract<ApplyAction, { type: "createCard" }>)
    : null;

  const applyPreset = () => {
    if (!jobId || !preset) return;
    let actions = preset.actions;
    if (draftAction) {
      actions = [
        {
          ...draftAction,
          title: editTitle ?? draftAction.title,
          description: editDescription ?? draftAction.description,
          listPublicId: editListPublicId ?? draftAction.listPublicId,
        },
      ];
    }
    applyMutation.mutate({ jobId, actions });
  };

  const postAsComment = () => {
    if (!jobId || !cardPublicId || !job.data?.result) return;
    applyMutation.mutate({
      jobId,
      actions: [
        { type: "addComment", cardPublicId, body: job.data.result },
      ],
    });
  };

  const applied = appliedIndexes.length > 0;
  const applyDisabled =
    !preset ||
    applied ||
    applyMutation.isPending ||
    (draftAction ? !(editListPublicId ?? draftAction.listPublicId) : false);

  const body = (
    <div className="space-y-4">
      {!jobId && !toolsConfirm && (
        <>
          <div className="grid gap-2">
            {allWorkers.map((worker) => {
              const usable =
                worker.needs === "none" ||
                (worker.needs === "board" && routeBoardId) ||
                (worker.needs === "card" && cardPublicId) ||
                (worker.needs === "either" && (routeBoardId ?? cardPublicId));
              return (
                <button
                  key={worker.name}
                  disabled={!usable}
                  onClick={() => setSelected(worker.name)}
                  className={clsx(
                    "rounded-kr8-md border p-3 text-left transition-colors disabled:opacity-40",
                    selected === worker.name
                      ? "border-kr8-accent bg-kr8-accent/8"
                      : "border-kr8-border bg-kr8-bg-elevated hover:bg-kr8-bg-muted",
                  )}
                >
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <HiOutlineSparkles className="h-4 w-4 text-kr8-accent" />
                    {worker.title}
                    {worker.allowTools && (
                      <span className="rounded-full bg-kr8-warning/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-kr8-warning">
                        tools
                      </span>
                    )}
                    {worker.custom && (
                      <span className="rounded-full bg-kr8-accent/12 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-kr8-accent">
                        custom
                      </span>
                    )}
                    {!usable && (
                      <span className="text-[11px] font-normal text-kr8-fg-muted">
                        needs a {worker.needs === "either" ? "board or card" : worker.needs}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[13px] text-kr8-fg-muted">
                    {worker.description}
                  </p>
                </button>
              );
            })}
            {workers.data && !workers.data.enabled && (
              <p className="text-[13px] text-kr8-warning">
                Pi workers are disabled — set KR8KAN_PI_WORKERS_ENABLED=true.
              </p>
            )}
            {!workers.data && (
              <p className="text-sm text-kr8-fg-muted">Loading workers…</p>
            )}
          </div>

          {selectedWorker?.allowTools && (
            <p className="rounded-kr8-sm border border-kr8-warning/40 bg-kr8-warning/10 p-3 text-[13px] text-kr8-warning">
              This worker runs pi <strong>with tools</strong> inside the board's
              linked project folder — it will read and edit real files there.
            </p>
          )}

          {selected && (
            <Textarea
              label="Prompt (optional)"
              placeholder={
                selected === "custom"
                  ? "What should the worker do?"
                  : "Extra instructions for this run…"
              }
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          )}

          {selected && !canRun && (
            <p className="text-[13px] text-kr8-warning">
              Open a board or card first — this worker needs that context.
            </p>
          )}

          <Button
            fullWidth
            loading={runMutation.isPending}
            disabled={!canRun}
            onClick={run}
            iconLeft={<HiOutlineSparkles className="h-4 w-4" />}
          >
            Run worker
          </Button>
        </>
      )}

      {!jobId && toolsConfirm && (
        <div className="space-y-3">
          <p className="rounded-kr8-sm border border-kr8-warning/40 bg-kr8-warning/10 p-3 text-[13px] text-kr8-warning">
            First tools run this session. The dev agent will run pi{" "}
            <strong>with read / bash / edit / write tools</strong> inside the
            board's linked project folder and can change real files there.
            Continue?
          </p>
          <div className="flex min-h-[44px] gap-2">
            <Button fullWidth onClick={run} loading={runMutation.isPending}>
              Run with tools
            </Button>
            <Button
              fullWidth
              variant="secondary"
              onClick={() => setToolsConfirm(false)}
            >
              Back
            </Button>
          </div>
        </div>
      )}

      {jobId && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            {job.data?.status === "completed" ? (
              <HiCheckCircle className="h-5 w-5 text-kr8-success" />
            ) : job.data?.status === "failed" ||
              job.data?.status === "cancelled" ? (
              <HiXCircle className="h-5 w-5 text-kr8-danger" />
            ) : (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-kr8-accent border-t-transparent" />
            )}
            <span className="font-medium capitalize">
              {job.data?.status ?? "starting"}
            </span>
            <span className="font-mono text-[11px] text-kr8-fg-muted">
              job {jobId}
            </span>
            {job.data?.verifyStatus && (
              <span
                className={clsx(
                  "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                  job.data.verifyStatus === "pass"
                    ? "bg-kr8-success/15 text-kr8-success"
                    : "bg-kr8-danger/15 text-kr8-danger",
                )}
              >
                verify {job.data.verifyStatus}
              </span>
            )}
            <div className="flex-1" />
            {(job.data?.status === "running" ||
              job.data?.status === "pending" ||
              !job.data) && (
              <Button
                size="sm"
                variant="secondary"
                loading={cancelMutation.isPending}
                onClick={() => cancelMutation.mutate({ jobId })}
              >
                Cancel
              </Button>
            )}
          </div>

          {(job.data?.status === "running" || job.data?.status === "pending") &&
            job.data?.progress && (
              <p className="truncate font-mono text-[12px] text-kr8-fg-muted">
                {job.data.progress}
              </p>
            )}

          {job.data?.status === "failed" && (
            <p className="rounded-kr8-sm border border-kr8-danger/40 bg-kr8-danger/10 p-3 text-[13px] text-kr8-danger">
              {job.data.error ?? "Worker failed"}
            </p>
          )}

          {parseError && (
            <p className="rounded-kr8-sm border border-kr8-warning/40 bg-kr8-warning/10 p-3 text-[13px] text-kr8-warning">
              Structured output failed to parse — apply is disabled. ({parseError})
            </p>
          )}

          {/* Editable draft-card preview */}
          {jobDone && draftAction && !applied && (
            <div className="space-y-2 rounded-kr8-md border border-kr8-border bg-kr8-bg-elevated p-3">
              <Input
                label="Card title"
                value={editTitle ?? draftAction.title}
                onChange={(e) => setEditTitle(e.target.value)}
              />
              <Textarea
                label="Description"
                value={editDescription ?? draftAction.description ?? ""}
                onChange={(e) => setEditDescription(e.target.value)}
              />
              <label className="block text-[13px]">
                <span className="mb-1 block text-kr8-fg-muted">List</span>
                <select
                  className="min-h-[44px] w-full rounded-kr8-sm border border-kr8-border bg-kr8-bg px-2 text-sm"
                  value={editListPublicId ?? draftAction.listPublicId}
                  onChange={(e) => setEditListPublicId(e.target.value)}
                >
                  <option value="">Pick a list…</option>
                  {boardLists.map((list) => (
                    <option key={list.publicId} value={list.publicId}>
                      {list.name}
                    </option>
                  ))}
                </select>
              </label>
              {draftAction.checklist?.length ? (
                <p className="text-[12px] text-kr8-fg-muted">
                  + checklist with {draftAction.checklist.length} items
                </p>
              ) : null}
            </div>
          )}

          {job.data?.result && (
            <div
              className="prose prose-sm max-h-[45dvh] max-w-none overflow-y-auto rounded-kr8-md border border-kr8-border bg-kr8-bg-elevated p-4 dark:prose-invert"
              dangerouslySetInnerHTML={{ __html: miniMarkdown(job.data.result) }}
            />
          )}

          <div className="flex flex-wrap gap-2">
            {jobDone && preset && (
              <Button
                loading={applyMutation.isPending}
                disabled={applyDisabled}
                onClick={applyPreset}
              >
                {applied ? "Applied" : preset.label}
              </Button>
            )}
            {job.data?.result && (
              <Button
                variant="secondary"
                iconLeft={<HiOutlineClipboard className="h-4 w-4" />}
                onClick={() => void copyResult()}
              >
                Copy
              </Button>
            )}
            {jobDone &&
              cardPublicId &&
              preset?.actions.every((a) => a.type !== "addComment") && (
                <Button
                  variant="secondary"
                  disabled={applied || applyMutation.isPending}
                  onClick={postAsComment}
                >
                  Post as comment
                </Button>
              )}
            <Button
              variant="ghost"
              onClick={() => {
                setJobId(null);
                setEditTitle(null);
                setEditDescription(null);
                setEditListPublicId(null);
                setAppliedIndexes([]);
                runMutation.reset();
                applyMutation.reset();
              }}
            >
              Run another
            </Button>
            <div className="flex-1" />
            <Button variant="secondary" onClick={onClose}>
              Dismiss
            </Button>
          </div>
        </div>
      )}
    </div>
  );

  return isMobile ? (
    <MobileSheet open={open} onClose={onClose} title="AI workers">
      {body}
    </MobileSheet>
  ) : (
    <Modal open={open} onClose={onClose} title="AI workers" size="lg">
      {body}
    </Modal>
  );
}
