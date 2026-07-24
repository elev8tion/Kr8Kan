import { useState } from "react";
import { HiOutlineBolt, HiPlus, HiOutlineTrash } from "react-icons/hi2";

import { Badge } from "~/components/Badge";
import { Button } from "~/components/Button";
import { Input } from "~/components/Input";
import { Modal } from "~/components/Modal";
import { SettingsLayout } from "~/components/SettingsLayout";
import { useToast } from "~/providers/toast";
import { useWorkspace } from "~/providers/workspace";
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
  url?: string;
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
    blurb: "Mon 09:00 → standup worker → post on this card",
    trigger: { type: "schedule", cron: "0 9 * * 1" },
    steps: [
      { type: "runWorker", worker: "standup" },
      {
        type: "postComment",
        bodyTemplate: "Weekly digest:\n\n{{steps.0.result.summary}}",
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
];

const TRIGGER_LABEL: Record<string, string> = {
  "card.created": "Card created",
  "card.moved": "Card moved",
  "label.added": "Label added",
  "card.due": "Card due soon",
  "comment.created": "Comment posted",
  "reaction.added": "Reaction added",
  schedule: "Schedule (cron)",
  webhook: "Webhook",
};

export default function WorkflowsSettingsPage() {
  const { activeWorkspace } = useWorkspace();
  const { toast } = useToast();
  const utils = api.useUtils();
  const wsId = activeWorkspace?.publicId ?? "";

  const [builderOpen, setBuilderOpen] = useState(false);
  const [name, setName] = useState("");
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
    onSettled: refresh,
    onError: (err) => toast(err.message, "error"),
  });
  const remove = api.workflow.delete.useMutation({
    onSettled: refresh,
    onError: (err) => toast(err.message, "error"),
  });

  const workerNames = [
    ...(((workers.data?.workers ?? []) as { name: string; allowTools?: boolean }[])
      .filter((w) => !w.allowTools)
      .map((w) => w.name)),
    ...(((customWorkers.data ?? []) as { name: string }[]).map((w) => w.name)),
  ];

  const loadTemplate = (key: string) => {
    const t = TEMPLATES.find((x) => x.key === key);
    if (!t) return;
    setName(t.name);
    setTrigger({ ...t.trigger });
    setSteps(t.steps.map((s) => ({ ...s })));
    setBuilderOpen(true);
  };

  const submit = () => {
    create.mutate({
      workspacePublicId: wsId,
      name: name.trim() || "Untitled workflow",
      trigger,
      steps,
    });
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
              setName("");
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
              trigger: { type: string };
              steps: { type: string }[];
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
                | { step: number; type: string; ok: boolean; detail?: string }[]
                | null;
              workflow: { name: string };
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
                      {run.stepResults!
                        .map((s) => `${s.ok ? "✓" : "✗"} ${s.type}${s.detail ? ` (${s.detail})` : ""}`)
                        .join(" → ")}
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
      <Modal open={builderOpen} onClose={() => setBuilderOpen(false)} title="Workflow" size="lg">
        <div className="space-y-4">
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />

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
                    <option value="callWebhook">Call webhook</option>
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
                  <Input
                    label="Comment body ({{card.title}}, {{steps.0.result.summary}}…)"
                    value={step.bodyTemplate ?? ""}
                    onChange={(e) => {
                      const next = [...steps];
                      next[i] = { ...step, bodyTemplate: e.target.value };
                      setSteps(next);
                    }}
                  />
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
              </div>
            ))}
          </div>

          <Button fullWidth loading={create.isPending} onClick={submit}>
            Create workflow
          </Button>
        </div>
      </Modal>
    </SettingsLayout>
  );
}
