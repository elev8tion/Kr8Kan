import { useState } from "react";
import Link from "next/link";
import { HiOutlineBolt, HiOutlinePencilSquare, HiPlus, HiOutlineTrash } from "react-icons/hi2";

import { Badge } from "~/components/Badge";
import { Button } from "~/components/Button";
import { Input } from "~/components/Input";
import { Modal } from "~/components/Modal";
import { SettingsLayout } from "~/components/SettingsLayout";
import { useToast } from "~/providers/toast";
import { useWorkspace } from "~/providers/workspace";
import { interpolate } from "@kr8kan/shared/interpolate";

import { api } from "~/utils/api";
import { relativeTime } from "~/utils/format";

/**
 * Workflows (Buzz-inspired): trigger → steps automations. Form-based
 * builder + templates — deliberately the boring version, no DAG canvas.
 */

interface TriggerDraft {
  type: string;
  listPublicId?: string;
  toListPublicId?: string;
  labelPublicId?: string;
  beforeHours?: number;
  contains?: string;
  emoji?: string;
  cron?: string;
  slug?: string;
  worker?: string;
  channelPublicId?: string;
}

interface StepDraft {
  type: string;
  worker?: string;
  promptTemplate?: string;
  emoji?: string;
  approvers?: string;
  timeoutHours?: number;
  autoApply?: boolean;
  bodyTemplate?: string;
  targetCardPublicId?: string;
  mode?: string;
  url?: string;
  channelPublicId?: string;
  expectText?: string;
  allowConsoleErrors?: boolean;
  preset?: string;
}

const TEMPLATES: {
  key: string;
  name: string;
  blurb: string;
  trigger: TriggerDraft;
  steps: StepDraft[];
}[] = [
  {
    key: "auto-triage",
    name: "Auto-triage new cards",
    blurb: "New card → triage worker → 👍 gate → move + label",
    trigger: { type: "card.created" },
    steps: [
      { type: "runWorker", worker: "triage-card" },
      { type: "gate", emoji: "👍", approvers: "member", timeoutHours: 24 },
      { type: "applyPreset", autoApply: false },
    ],
  },
  {
    key: "standup-digest",
    name: "Weekly standup digest",
    blurb: "Mon 09:00 → standup worker → board notes (pick a board)",
    trigger: { type: "schedule", cron: "0 9 * * 1" },
    steps: [
      { type: "runWorker", worker: "standup" },
      {
        type: "postNote",
        mode: "append",
        bodyTemplate: "## Weekly digest\n\n{{steps.0.result.summary}}",
      },
    ],
  },
  {
    key: "standup-to-channel",
    name: "Weekly standup → channel",
    blurb: "Mon 09:00 → standup worker → posted to a channel (pick one)",
    trigger: { type: "schedule", cron: "0 9 * * 1" },
    steps: [
      { type: "runWorker", worker: "standup" },
      {
        type: "postMessage",
        bodyTemplate: "## Weekly digest\n\n{{steps.0.result.summary}}",
      },
    ],
  },
  {
    key: "due-nudge",
    name: "Due-date nudge",
    blurb: "Card due in 24h → reminder comment",
    trigger: { type: "card.due", beforeHours: 24 },
    steps: [
      {
        type: "postComment",
        bodyTemplate: "⏰ **{{card.title}}** is due within 24 hours.",
      },
    ],
  },
  {
    key: "eval-review",
    name: "Eval review (weekly)",
    blurb:
      "Mon 08:00 → eval reviewer studies rejections + judge fails → proposals land in board notes (text only — humans decide what to adopt)",
    trigger: { type: "schedule", cron: "0 8 * * 1" },
    steps: [
      { type: "runWorker", worker: "eval-reviewer" },
      {
        type: "postNote",
        mode: "append",
        bodyTemplate:
          "## 🧪 Eval review\n\n{{steps.0.result.summary}}",
      },
    ],
  },
  {
    key: "sentinel",
    name: "Sentinel: investigate failed jobs",
    blurb: "Job fails → diagnostician researches → finding lands in board notes",
    trigger: { type: "job.failed" },
    steps: [
      { type: "runWorker", worker: "diagnostician" },
      {
        type: "postNote",
        mode: "append",
        bodyTemplate:
          "## 🚨 System finding — job {{trigger.jobId}} ({{trigger.worker}})\n\n**What failed:** {{steps.0.result.whatFailed}}\n\n**Probable cause:** {{steps.0.result.probableCause}}\n\n**Suggested fix:** {{steps.0.result.suggestedFix}}",
      },
    ],
  },
];

const TRIGGER_LABEL: Record<string, string> = {
  "card.created": "Card created",
  "card.moved": "Card moved",
  "label.added": "Label added",
  "card.due": "Card due soon",
  "comment.created": "Comment posted",
  "message.posted": "Channel message posted",
  "reaction.added": "Reaction added",
  schedule: "Schedule (cron)",
  webhook: "Webhook",
  "job.failed": "Job failed (system)",
  "job.verify_failed": "Job verify failed (system)",
  "workflow.run.failed": "Workflow run failed (system)",
};

export default function WorkflowsSettingsPage() {
  const { activeWorkspace } = useWorkspace();
  const { toast } = useToast();
  const utils = api.useUtils();
  const wsId = activeWorkspace?.publicId ?? "";

  const [builderOpen, setBuilderOpen] = useState(false);
  /** Set = editing that workflow; null = creating a new one. */
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [boardPublicId, setBoardPublicId] = useState("");
  const [trigger, setTrigger] = useState<TriggerDraft>({ type: "card.created" });
  const [steps, setSteps] = useState<StepDraft[]>([]);

  const workflows = api.workflow.list.useQuery(
    { workspacePublicId: wsId },
    { enabled: Boolean(activeWorkspace) },
  );
  const runs = api.workflow.runs.useQuery(
    { workspacePublicId: wsId, limit: 25 },
    { enabled: Boolean(activeWorkspace), refetchInterval: 5000 },
  );
  const boards = api.board.list.useQuery(
    { workspacePublicId: wsId },
    { enabled: Boolean(activeWorkspace) },
  );
  const channels = api.channel.list.useQuery(
    { workspacePublicId: wsId },
    { enabled: Boolean(activeWorkspace) },
  );
  const workers = api.agent.listWorkers.useQuery();
  const customWorkers = api.agent.listCustomWorkers.useQuery(
    { workspacePublicId: wsId },
    { enabled: Boolean(activeWorkspace) },
  );

  const refresh = () => {
    void utils.workflow.list.invalidate();
    void utils.workflow.runs.invalidate();
  };
  const create = api.workflow.create.useMutation({
    onSuccess: () => {
      toast("Workflow created", "success");
      setBuilderOpen(false);
      setName("");
      setSteps([]);
      refresh();
    },
    onError: (err) => toast(err.message, "error"),
  });
  const update = api.workflow.update.useMutation({
    onSuccess: () => {
      if (builderOpen) {
        toast("Workflow updated", "success");
        setBuilderOpen(false);
      }
    },
    onSettled: refresh,
    onError: (err) => toast(err.message, "error"),
  });
  const remove = api.workflow.delete.useMutation({
    onSettled: refresh,
    onError: (err) => toast(err.message, "error"),
  });

  // Tools workers (dev-task) are allowed since sandbox isolation landed:
  // workflow runs execute in a git worktree and land as 👍-gated patches.
  const workerNames = [
    ...(((workers.data?.workers ?? []) as { name: string }[]).map((w) => w.name)),
    ...(((customWorkers.data ?? []) as { name: string }[]).map((w) => w.name)),
  ];

  const loadTemplate = (key: string) => {
    const t = TEMPLATES.find((x) => x.key === key);
    if (!t) return;
    setEditing(null);
    setName(t.name);
    setBoardPublicId("");
    setTrigger({ ...t.trigger });
    setSteps(t.steps.map((s) => ({ ...s })));
    setBuilderOpen(true);
  };

  const loadForEdit = (wf: {
    publicId: string;
    name: string;
    boardPublicId?: string | null;
    trigger: TriggerDraft;
    steps: StepDraft[];
  }) => {
    setEditing(wf.publicId);
    setName(wf.name);
    setBoardPublicId(wf.boardPublicId ?? "");
    setTrigger({ ...wf.trigger });
    setSteps(wf.steps.map((s) => ({ ...s })));
    setBuilderOpen(true);
  };

  // Card-less triggers need a board; schedule/webhook postComment steps
  // need a fixed target card.
  const cardlessTrigger = trigger.type === "schedule" || trigger.type === "webhook";
  const needsBoard =
    (trigger.type === "schedule" || trigger.type === "card.due") && !boardPublicId;
  const needsTargetCard =
    cardlessTrigger &&
    steps.some(
      (s) => s.type === "postComment" && !(s.targetCardPublicId ?? "").trim(),
    );
  const submitBlocked = needsBoard || needsTargetCard;
  const submitHint = needsBoard
    ? "Pick a board — scheduled and due-date workflows need one."
    : needsTargetCard
      ? "Post-comment steps need a target card publicId when the trigger has no card."
      : null;

  const submit = () => {
    if (submitBlocked) return;
    const payload = {
      name: name.trim() || "Untitled workflow",
      boardPublicId: boardPublicId || null,
      trigger,
      steps,
    };
    if (editing) {
      update.mutate({ workflowPublicId: editing, ...payload });
    } else {
      create.mutate({ workspacePublicId: wsId, ...payload });
    }
  };

  return (
    <SettingsLayout title="Workflows">
      <div className="max-w-3xl space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          {TEMPLATES.map((t) => (
            <button
              key={t.key}
              onClick={() => loadTemplate(t.key)}
              className="rounded-kr8-md border border-kr8-border bg-kr8-bg-elevated p-3 text-left hover:border-kr8-accent"
            >
              <div className="flex items-center gap-1.5 text-[13px] font-semibold">
                <HiOutlineBolt className="h-4 w-4 text-kr8-accent" /> {t.name}
              </div>
              <p className="mt-0.5 text-[12px] text-kr8-fg-muted">{t.blurb}</p>
            </button>
          ))}
          <Button
            variant="secondary"
            iconLeft={<HiPlus className="h-4 w-4" />}
            onClick={() => {
              setEditing(null);
              setName("");
              setBoardPublicId("");
              setTrigger({ type: "card.created" });
              setSteps([{ type: "postComment", bodyTemplate: "" }]);
              setBuilderOpen(true);
            }}
          >
            From scratch
          </Button>
        </div>

        {/* Existing workflows */}
        <section>
          <h2 className="mb-2 text-[15px] font-semibold">Workflows</h2>
          <ul className="space-y-2">
            {((workflows.data ?? []) as unknown as {
              publicId: string;
              name: string;
              enabled: boolean;
              boardPublicId: string | null;
              trigger: TriggerDraft;
              steps: StepDraft[];
              lastFiredAt: string | Date | null;
            }[]).map(
              (wf) => (
                <li
                  key={wf.publicId}
                  className="flex flex-wrap items-center gap-2 rounded-kr8-md border border-kr8-border bg-kr8-bg-elevated px-3 py-2.5"
                >
                  <span className="text-sm font-medium">{wf.name}</span>
                  <Badge>{TRIGGER_LABEL[wf.trigger.type] ?? wf.trigger.type}</Badge>
                  <span className="text-[12px] text-kr8-fg-muted">
                    {wf.steps.map((s) => s.type).join(" → ")}
                  </span>
                  <div className="ml-auto flex items-center gap-2">
                    {wf.lastFiredAt && (
                      <span className="text-[11px] text-kr8-fg-muted">
                        fired {relativeTime(wf.lastFiredAt)}
                      </span>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Edit workflow"
                      onClick={() => loadForEdit(wf)}
                    >
                      <HiOutlinePencilSquare className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant={wf.enabled ? "secondary" : "primary"}
                      onClick={() =>
                        update.mutate({
                          workflowPublicId: wf.publicId,
                          enabled: !wf.enabled,
                        })
                      }
                    >
                      {wf.enabled ? "Disable" : "Enable"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Delete workflow"
                      onClick={() =>
                        remove.mutate({ workflowPublicId: wf.publicId })
                      }
                    >
                      <HiOutlineTrash className="h-4 w-4 text-kr8-danger" />
                    </Button>
                  </div>
                </li>
              ),
            )}
            {workflows.data?.length === 0 && (
              <p className="text-sm text-kr8-fg-muted">
                No workflows yet — start from a template above.
              </p>
            )}
          </ul>
        </section>

        {/* Run history */}
        <section>
          <h2 className="mb-2 text-[15px] font-semibold">Recent runs</h2>
          <ul className="space-y-1.5">
            {((runs.data ?? []) as unknown as {
              publicId: string;
              status: string;
              startedAt: string | Date;
              error: string | null;
              cardPublicId: string | null;
              stepResults:
                | {
                    step: number;
                    type: string;
                    ok: boolean;
                    detail?: string;
                    jobId?: string;
                  }[]
                | null;
              workflow: { name: string; publicId?: string };
              boardPublicId?: string | null;
            }[]).map(
              (run) => (
                <li
                  key={run.publicId}
                  className="rounded-kr8-sm border border-kr8-border bg-kr8-bg-elevated px-3 py-2 text-[13px]"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      tone={
                        run.status === "completed"
                          ? "success"
                          : run.status === "failed"
                            ? "danger"
                            : run.status === "waiting_gate"
                              ? "accent"
                              : "neutral"
                      }
                    >
                      {run.status === "waiting_gate" ? "awaiting 👍" : run.status}
                    </Badge>
                    <span className="font-medium">{run.workflow.name}</span>
                    <span className="ml-auto text-[11px] text-kr8-fg-muted">
                      {relativeTime(run.startedAt)}
                    </span>
                  </div>
                  {(run.stepResults?.length ?? 0) > 0 && (
                    <p className="mt-1 font-mono text-[11px] text-kr8-fg-muted">
                      {run.stepResults!.map((s, idx) => (
                        <span key={idx}>
                          {idx > 0 && " → "}
                          {s.ok ? "✓" : "✗"}{" "}
                          {s.jobId ? (
                            <Link
                              href="/settings/agents"
                              className="underline decoration-dotted hover:text-kr8-accent"
                              title={`job ${s.jobId}`}
                            >
                              {s.type}
                            </Link>
                          ) : (
                            s.type
                          )}
                          {s.detail ? ` (${s.detail})` : ""}
                        </span>
                      ))}
                    </p>
                  )}
                  {run.cardPublicId && (
                    <p className="mt-1 text-[11px]">
                      {(() => {
                        const wfBoard = ((workflows.data ?? []) as unknown as {
                          publicId: string;
                          boardPublicId: string | null;
                        }[]).find((w) => w.publicId === (run.workflow as { publicId?: string }).publicId)?.boardPublicId;
                        return wfBoard ? (
                          <Link
                            href={`/boards/${wfBoard}?card=${run.cardPublicId}`}
                            className="text-kr8-accent underline decoration-dotted"
                          >
                            open card {run.cardPublicId}
                          </Link>
                        ) : (
                          <span className="font-mono text-kr8-fg-muted">
                            card {run.cardPublicId}
                          </span>
                        );
                      })()}
                    </p>
                  )}
                  {run.error && (
                    <p className="mt-1 text-[12px] text-kr8-danger">{run.error}</p>
                  )}
                </li>
              ),
            )}
            {runs.data?.length === 0 && (
              <p className="text-sm text-kr8-fg-muted">No runs yet.</p>
            )}
          </ul>
        </section>
      </div>

      {/* Builder */}
      <Modal
        open={builderOpen}
        onClose={() => setBuilderOpen(false)}
        title={editing ? "Edit workflow" : "Workflow"}
        size="lg"
      >
        <div className="space-y-4">
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />

          <label className="block text-[13px]">
            <span className="mb-1 block text-kr8-fg-muted">
              Board{" "}
              {trigger.type === "schedule" || trigger.type === "card.due"
                ? "(required for this trigger)"
                : "(optional — scopes the trigger)"}
            </span>
            <select
              className="min-h-[44px] w-full rounded-kr8-sm border border-kr8-border bg-kr8-bg px-2 text-sm"
              value={boardPublicId}
              onChange={(e) => setBoardPublicId(e.target.value)}
            >
              <option value="">Whole workspace</option>
              {((boards.data ?? []) as { publicId: string; name: string }[]).map(
                (b) => (
                  <option key={b.publicId} value={b.publicId}>
                    {b.name}
                  </option>
                ),
              )}
            </select>
          </label>

          <div>
            <label className="mb-1 block text-[13px] text-kr8-fg-muted">Trigger</label>
            <select
              className="min-h-[44px] w-full rounded-kr8-sm border border-kr8-border bg-kr8-bg px-2 text-sm"
              value={trigger.type}
              onChange={(e) => setTrigger({ type: e.target.value })}
            >
              {Object.entries(TRIGGER_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            {trigger.type === "card.due" && (
              <Input
                label="Hours before due"
                type="number"
                value={String(trigger.beforeHours ?? 24)}
                onChange={(e) =>
                  setTrigger({ ...trigger, beforeHours: Number(e.target.value) || 24 })
                }
              />
            )}
            {trigger.type === "schedule" && (
              <Input
                label="Cron (minute hour day month weekday)"
                placeholder="0 9 * * 1"
                value={trigger.cron ?? ""}
                onChange={(e) => setTrigger({ ...trigger, cron: e.target.value })}
              />
            )}
            {trigger.type === "webhook" && (
              <Input
                label="Slug"
                placeholder="ci-finished"
                value={trigger.slug ?? ""}
                onChange={(e) => setTrigger({ ...trigger, slug: e.target.value })}
              />
            )}
            {trigger.type === "message.posted" && (
              <>
                <label className="block text-[13px]">
                  <span className="mb-1 block text-kr8-fg-muted">
                    Channel (optional — any channel when empty)
                  </span>
                  <select
                    className="min-h-[40px] w-full rounded-kr8-sm border border-kr8-border bg-kr8-bg px-2 text-sm"
                    value={trigger.channelPublicId ?? ""}
                    onChange={(e) =>
                      setTrigger({
                        ...trigger,
                        channelPublicId: e.target.value || undefined,
                      })
                    }
                  >
                    <option value="">Any channel</option>
                    {(
                      (channels.data ?? []) as {
                        publicId: string;
                        name: string;
                      }[]
                    ).map((c) => (
                      <option key={c.publicId} value={c.publicId}>
                        #{c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <Input
                  label="Only when the message contains (optional)"
                  value={trigger.contains ?? ""}
                  onChange={(e) =>
                    setTrigger({
                      ...trigger,
                      contains: e.target.value || undefined,
                    })
                  }
                />
                <p className="text-[12px] text-kr8-fg-muted">
                  Fires on human messages only — agent replies never trigger
                  workflows, so answer loops can&apos;t chain.
                </p>
              </>
            )}
            {trigger.type === "comment.created" && (
              <Input
                label="Only when comment contains (optional)"
                value={trigger.contains ?? ""}
                onChange={(e) => setTrigger({ ...trigger, contains: e.target.value })}
              />
            )}
            {trigger.type === "reaction.added" && (
              <Input
                label="Emoji"
                placeholder="👍"
                value={trigger.emoji ?? ""}
                onChange={(e) => setTrigger({ ...trigger, emoji: e.target.value })}
              />
            )}
            {(trigger.type === "job.failed" ||
              trigger.type === "job.verify_failed") && (
              <Input
                label="Only for worker (optional — blank matches every worker)"
                placeholder="dev-task"
                value={trigger.worker ?? ""}
                onChange={(e) =>
                  setTrigger({ ...trigger, worker: e.target.value || undefined })
                }
              />
            )}
            {(trigger.type === "job.failed" ||
              trigger.type === "job.verify_failed" ||
              trigger.type === "workflow.run.failed") && (
              <p className="mt-1 text-xs text-kr8-fg-muted">
                System trigger: fires when the app itself detects a failure.
                Jobs started by workflows never re-fire it, so diagnostician
                loops can&apos;t chain.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[13px] text-kr8-fg-muted">Steps (in order)</label>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setSteps([...steps, { type: "postComment", bodyTemplate: "" }])}
              >
                Add step
              </Button>
            </div>
            {steps.map((step, i) => (
              <div
                key={i}
                className="space-y-2 rounded-kr8-md border border-kr8-border bg-kr8-bg-elevated p-3"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-kr8-fg-muted">{i + 1}.</span>
                  <select
                    className="min-h-[40px] flex-1 rounded-kr8-sm border border-kr8-border bg-kr8-bg px-2 text-sm"
                    value={step.type}
                    onChange={(e) => {
                      const next = [...steps];
                      next[i] = { type: e.target.value };
                      setSteps(next);
                    }}
                  >
                    <option value="runWorker">Run worker</option>
                    <option value="gate">Approval gate (👍)</option>
                    <option value="applyPreset">Apply worker result</option>
                    <option value="postComment">Post comment</option>
                    <option value="postNote">Post to board notes</option>
                    <option value="postMessage">Post to channel</option>
                    <option value="callWebhook">Call webhook</option>
                    <option value="checkUrl">Check page (browser)</option>
                    <option value="captureScreenshot">
                      Screenshot page (browser)
                    </option>
                  </select>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Remove step"
                    onClick={() => setSteps(steps.filter((_, j) => j !== i))}
                  >
                    <HiOutlineTrash className="h-4 w-4" />
                  </Button>
                </div>
                {step.type === "runWorker" && (
                  <>
                    <select
                      className="min-h-[40px] w-full rounded-kr8-sm border border-kr8-border bg-kr8-bg px-2 text-sm"
                      value={step.worker ?? ""}
                      onChange={(e) => {
                        const next = [...steps];
                        next[i] = { ...step, worker: e.target.value };
                        setSteps(next);
                      }}
                    >
                      <option value="">Pick a worker…</option>
                      {workerNames.map((w) => (
                        <option key={w} value={w}>
                          {w}
                        </option>
                      ))}
                    </select>
                    {step.worker === "dev-task" && (
                      <p className="text-[12px] text-kr8-fg-muted">
                        Runs in an isolated sandbox (git worktree) of the
                        board&apos;s linked folder — requires the folder to be a
                        git repo. Changes land as a patch proposal on the card;
                        a human 👍 applies them. The live tree is never edited
                        by the workflow itself.
                      </p>
                    )}
                    <Input
                      label="Prompt template (optional — {{card.title}} etc.)"
                      value={step.promptTemplate ?? ""}
                      onChange={(e) => {
                        const next = [...steps];
                        next[i] = { ...step, promptTemplate: e.target.value };
                        setSteps(next);
                      }}
                    />
                  </>
                )}
                {step.type === "gate" && (
                  <p className="text-[12px] text-kr8-fg-muted">
                    Posts an approval comment on the card; 👍 continues, ❌ stops.
                    Expires after {step.timeoutHours ?? 24}h.
                  </p>
                )}
                {step.type === "applyPreset" && (
                  <p className="text-[12px] text-kr8-fg-muted">
                    Applies the previous worker's parsed result. Needs a gate right
                    before it (no silent board mutation).
                  </p>
                )}
                {step.type === "postComment" && (
                  <>
                    <Input
                      label="Comment body ({{card.title}}, {{steps.0.result.summary}}…)"
                      value={step.bodyTemplate ?? ""}
                      onChange={(e) => {
                        const next = [...steps];
                        next[i] = { ...step, bodyTemplate: e.target.value };
                        setSteps(next);
                      }}
                    />
                    {cardlessTrigger && (
                      <Input
                        label="Target card publicId (required — this trigger has no card)"
                        placeholder="12-char card id, e.g. from the card's detail header"
                        value={step.targetCardPublicId ?? ""}
                        onChange={(e) => {
                          const next = [...steps];
                          next[i] = { ...step, targetCardPublicId: e.target.value };
                          setSteps(next);
                        }}
                      />
                    )}
                  </>
                )}
                {step.type === "postNote" && (
                  <>
                    <Input
                      label="Note body ({{card.title}}, {{steps.0.result.summary}}…)"
                      value={step.bodyTemplate ?? ""}
                      onChange={(e) => {
                        const next = [...steps];
                        next[i] = { ...step, bodyTemplate: e.target.value };
                        setSteps(next);
                      }}
                    />
                    <label className="block text-[13px]">
                      <span className="mb-1 block text-kr8-fg-muted">Mode</span>
                      <select
                        className="min-h-[40px] w-full rounded-kr8-sm border border-kr8-border bg-kr8-bg px-2 text-sm"
                        value={step.mode ?? "append"}
                        onChange={(e) => {
                          const next = [...steps];
                          next[i] = { ...step, mode: e.target.value };
                          setSteps(next);
                        }}
                      >
                        <option value="append">Append (dated section)</option>
                        <option value="replace">Replace the whole note</option>
                      </select>
                    </label>
                    <p className="text-[12px] text-kr8-fg-muted">
                      Writes to the workflow board's Notes doc — no card needed.
                    </p>
                  </>
                )}
                {step.type === "postMessage" && (
                  <>
                    <Input
                      label="Message body ({{steps.0.result.summary}}, {{trigger.messageBody}}…)"
                      value={step.bodyTemplate ?? ""}
                      onChange={(e) => {
                        const next = [...steps];
                        next[i] = { ...step, bodyTemplate: e.target.value };
                        setSteps(next);
                      }}
                    />
                    <label className="block text-[13px]">
                      <span className="mb-1 block text-kr8-fg-muted">
                        Channel
                        {trigger.type === "message.posted"
                          ? " (optional — defaults to the triggering channel)"
                          : " (required — this trigger has no channel)"}
                      </span>
                      <select
                        className="min-h-[40px] w-full rounded-kr8-sm border border-kr8-border bg-kr8-bg px-2 text-sm"
                        value={step.channelPublicId ?? ""}
                        onChange={(e) => {
                          const next = [...steps];
                          next[i] = {
                            ...step,
                            channelPublicId: e.target.value || undefined,
                          };
                          setSteps(next);
                        }}
                      >
                        <option value="">
                          {trigger.type === "message.posted"
                            ? "Triggering channel"
                            : "Pick a channel…"}
                        </option>
                        {(
                          (channels.data ?? []) as {
                            publicId: string;
                            name: string;
                          }[]
                        ).map((c) => (
                          <option key={c.publicId} value={c.publicId}>
                            #{c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
                {step.type === "callWebhook" && (
                  <Input
                    label="URL (POST, JSON body)"
                    placeholder="https://…"
                    value={step.url ?? ""}
                    onChange={(e) => {
                      const next = [...steps];
                      next[i] = { ...step, url: e.target.value };
                      setSteps(next);
                    }}
                  />
                )}
                {step.type === "checkUrl" && (
                  <div className="space-y-2">
                    <Input
                      label="URL to open"
                      placeholder="http://localhost:3310"
                      value={step.url ?? ""}
                      onChange={(e) => {
                        const next = [...steps];
                        next[i] = { ...step, url: e.target.value };
                        setSteps(next);
                      }}
                      hint="Needs KR8KAN_BROWSER_ENABLED and the host in KR8KAN_BROWSER_ALLOWED_HOSTS."
                    />
                    <Input
                      label="Expect text (optional)"
                      placeholder="Sprint board"
                      value={step.expectText ?? ""}
                      onChange={(e) => {
                        const next = [...steps];
                        next[i] = { ...step, expectText: e.target.value };
                        setSteps(next);
                      }}
                    />
                    <label className="flex items-center gap-2 text-[13px]">
                      <input
                        type="checkbox"
                        checked={Boolean(step.allowConsoleErrors)}
                        onChange={(e) => {
                          const next = [...steps];
                          next[i] = {
                            ...step,
                            allowConsoleErrors: e.target.checked,
                          };
                          setSteps(next);
                        }}
                      />
                      Allow console errors (otherwise they fail the step)
                    </label>
                  </div>
                )}
                {step.type === "captureScreenshot" && (
                  <div className="space-y-2">
                    <Input
                      label="URL to screenshot"
                      placeholder="http://localhost:3310"
                      value={step.url ?? ""}
                      onChange={(e) => {
                        const next = [...steps];
                        next[i] = { ...step, url: e.target.value };
                        setSteps(next);
                      }}
                    />
                    <label className="block text-[13px]">
                      <span className="mb-1 block text-kr8-fg-muted">
                        Viewport
                      </span>
                      <select
                        className="min-h-[44px] w-full rounded-kr8-sm border border-kr8-border bg-kr8-bg px-2 text-sm"
                        value={step.preset ?? ""}
                        onChange={(e) => {
                          const next = [...steps];
                          next[i] = {
                            ...step,
                            preset: e.target.value || undefined,
                          };
                          setSteps(next);
                        }}
                      >
                        <option value="">Default window</option>
                        <option value="mobile-m">Mobile — 375 × 667</option>
                        <option value="tablet">Tablet — 768 × 1024</option>
                        <option value="laptop">Laptop — 1024 × 768</option>
                        <option value="desktop">Desktop — 1920 × 1080</option>
                      </select>
                    </label>
                  </div>
                )}
              </div>
            ))}
          </div>

          {previewOpen && steps.length > 0 && (
            <div className="space-y-2 rounded-kr8-md border border-kr8-accent/40 bg-kr8-accent/5 p-3">
              <p className="text-[13px] font-semibold">
                Dry run — what would happen (no mutations)
              </p>
              {steps.map((step, i) => {
                const mockScope = {
                  card: { title: "Example card", publicId: "crd000000000" },
                  workflow: { name: name || "Untitled workflow" },
                  trigger: { type: trigger.type },
                  steps: [],
                };
                const body = step.bodyTemplate
                  ? interpolate(step.bodyTemplate, mockScope)
                  : "";
                return (
                  <div key={i} className="text-[13px]">
                    <span className="font-mono text-[11px] text-kr8-fg-muted">
                      {i + 1}.
                    </span>{" "}
                    {step.type === "runWorker" && (
                      <span>
                        Runs <strong>{step.worker || "(no worker picked)"}</strong>
                        {step.promptTemplate && (
                          <>
                            {" "}with prompt: <em className="text-kr8-fg-muted">
                              {interpolate(step.promptTemplate, mockScope)}
                            </em>
                          </>
                        )}
                      </span>
                    )}
                    {step.type === "gate" && (
                      <span>
                        Posts an approval comment: "<em>Approval needed — workflow{" "}
                        {name || "Untitled workflow"} … React {step.emoji ?? "👍"} to
                        approve</em>", waits up to {step.timeoutHours ?? 24}h.
                      </span>
                    )}
                    {step.type === "applyPreset" && (
                      <span>
                        Applies the previous worker's parsed result
                        {step.autoApply
                          ? " automatically (autoApply)."
                          : " — blocked until the 👍 gate approves."}
                      </span>
                    )}
                    {step.type === "postComment" && (
                      <span>
                        Comments{step.targetCardPublicId ? ` on card ${step.targetCardPublicId}` : " on the trigger card"}:{" "}
                        <em className="text-kr8-fg-muted">{body || "(empty body)"}</em>
                      </span>
                    )}
                    {step.type === "postNote" && (
                      <span>
                        {step.mode === "replace" ? "Replaces" : "Appends to"} the
                        board notes: <em className="text-kr8-fg-muted">{body || "(empty body)"}</em>
                      </span>
                    )}
                    {step.type === "callWebhook" && (
                      <span>
                        POSTs {"{workflow, run, trigger, cardPublicId}"} to{" "}
                        <span className="font-mono text-[12px]">{step.url || "(no URL)"}</span>
                      </span>
                    )}
                    {step.type === "checkUrl" && (
                      <span>
                        Opens{" "}
                        <span className="font-mono text-[12px]">
                          {step.url || "(no URL)"}
                        </span>{" "}
                        and fails the run if it does not load
                        {step.expectText ? `, is missing “${step.expectText}”` : ""}
                        {step.allowConsoleErrors ? "" : ", or throws in the console"}
                      </span>
                    )}
                    {step.type === "captureScreenshot" && (
                      <span>
                        Screenshots{" "}
                        <span className="font-mono text-[12px]">
                          {step.url || "(no URL)"}
                        </span>{" "}
                        at {step.preset ?? "the default window"} and attaches it
                        to the run
                      </span>
                    )}
                  </div>
                );
              })}
              <p className="text-[11px] text-kr8-fg-muted">
                Variables referencing step results ({"{{steps.0.result…}}"}) render
                empty in preview — they only exist during a real run.
              </p>
            </div>
          )}
          {submitHint && (
            <p className="text-[13px] text-kr8-warning">{submitHint}</p>
          )}
          <div className="flex gap-2">
            <Button
              variant="secondary"
              disabled={steps.length === 0}
              onClick={() => setPreviewOpen(!previewOpen)}
            >
              {previewOpen ? "Hide preview" : "Preview"}
            </Button>
            <Button
              fullWidth
              loading={create.isPending || update.isPending}
              disabled={submitBlocked}
              onClick={submit}
            >
              {editing ? "Save workflow" : "Create workflow"}
            </Button>
          </div>
        </div>
      </Modal>
    </SettingsLayout>
  );
}
