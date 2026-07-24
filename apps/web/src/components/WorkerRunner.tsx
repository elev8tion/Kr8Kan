import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import clsx from "clsx";
import {
  HiCheckCircle,
  HiOutlineClipboard,
  HiOutlineSparkles,
  HiXCircle,
} from "react-icons/hi2";

import { Button } from "./Button";
import { MobileSheet } from "./MobileSheet";
import { Modal } from "./Modal";
import { Textarea } from "./Input";
import { useIsMobile } from "~/hooks/useIsMobile";
import { useToast } from "~/providers/toast";
import { api } from "~/utils/api";
import { miniMarkdown } from "~/utils/format";

interface WorkerInfo {
  name: string;
  title: string;
  description: string;
  needs: "board" | "card" | "either" | "none";
  allowTools?: boolean;
}

interface WorkerRunnerProps {
  open: boolean;
  onClose: () => void;
  /** Pre-scoped context: pass from board/card views */
  boardPublicId?: string;
  cardPublicId?: string;
}

/**
 * "Run AI worker" flow: pick worker → optional prompt → run → live job
 * status → result markdown with copy / create-cards actions.
 * Bottom sheet on mobile, centered modal on desktop.
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
  const [selected, setSelected] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);

  // Board context can come from the route when not passed explicitly
  const routeBoardId =
    boardPublicId ??
    (typeof router.query.boardPublicId === "string"
      ? router.query.boardPublicId
      : undefined);

  const workers = api.agent.listWorkers.useQuery(undefined, { enabled: open });
  const runMutation = api.agent.run.useMutation({
    onSuccess: (data: { jobId: string }) => setJobId(data.jobId),
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
      runMutation.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const selectedWorker = useMemo(
    () =>
      (workers.data?.workers as WorkerInfo[] | undefined)?.find(
        (w) => w.name === selected,
      ),
    [workers.data, selected],
  );

  const canRun = useMemo(() => {
    if (!selectedWorker) return false;
    if (selectedWorker.needs === "board") return Boolean(routeBoardId);
    if (selectedWorker.needs === "card") return Boolean(cardPublicId);
    return Boolean(routeBoardId ?? cardPublicId);
  }, [selectedWorker, routeBoardId, cardPublicId]);

  const run = () => {
    if (!selected) return;
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

  const body = (
    <div className="space-y-4">
      {!jobId && (
        <>
          <div className="grid gap-2">
            {(workers.data?.workers as WorkerInfo[] | undefined)?.map((worker) => {
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
          </div>

          {job.data?.status === "failed" && (
            <p className="rounded-kr8-sm border border-kr8-danger/40 bg-kr8-danger/10 p-3 text-[13px] text-kr8-danger">
              {job.data.error ?? "Worker failed"}
            </p>
          )}

          {job.data?.result && (
            <div
              className="prose prose-sm max-h-[45dvh] max-w-none overflow-y-auto rounded-kr8-md border border-kr8-border bg-kr8-bg-elevated p-4 dark:prose-invert"
              dangerouslySetInnerHTML={{ __html: miniMarkdown(job.data.result) }}
            />
          )}

          <div className="flex gap-2">
            {job.data?.result && (
              <Button
                variant="secondary"
                iconLeft={<HiOutlineClipboard className="h-4 w-4" />}
                onClick={() => void copyResult()}
              >
                Copy
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={() => {
                setJobId(null);
                runMutation.reset();
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
