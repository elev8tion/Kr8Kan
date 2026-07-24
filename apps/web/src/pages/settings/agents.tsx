import { useState } from "react";
import {
  HiCheckCircle,
  HiOutlineSparkles,
  HiXCircle,
} from "react-icons/hi2";

import { AgentAvatar } from "~/components/AgentAvatar";
import { Badge } from "~/components/Badge";
import { Button } from "~/components/Button";
import { Input } from "~/components/Input";
import { Textarea } from "~/components/Input";
import { Modal } from "~/components/Modal";
import { SettingsLayout } from "~/components/SettingsLayout";
import { WorkerRunner } from "~/components/WorkerRunner";
import { useWorkspace } from "~/providers/workspace";
import { useToast } from "~/providers/toast";
import { api } from "~/utils/api";
import { miniMarkdown, relativeTime } from "~/utils/format";

export default function AgentsSettingsPage() {
  const [testOpen, setTestOpen] = useState(false);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  /** Set = editing that worker (slug immutable); null = creating. */
  const [editingWorker, setEditingWorker] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    name: "",
    title: "",
    avatar: "✨",
    description: "",
    systemPrompt: "",
    outputMode: "freeform",
    schemaWorker: "",
  });
  const { activeWorkspace } = useWorkspace();
  const { toast } = useToast();
  const utils = api.useUtils();

  const health = api.agent.health.useQuery();
  const workers = api.agent.listWorkers.useQuery();
  const [jobWorker, setJobWorker] = useState("");
  const [jobStatus, setJobStatus] = useState("");
  const [jobBoard, setJobBoard] = useState("");
  const boards = api.board.list.useQuery(
    { workspacePublicId: activeWorkspace?.publicId ?? "" },
    { enabled: Boolean(activeWorkspace) },
  );
  const jobs = api.agent.jobs.useQuery(
    {
      workspacePublicId: activeWorkspace?.publicId ?? "",
      worker: jobWorker || undefined,
      status: (jobStatus || undefined) as
        | "pending"
        | "running"
        | "completed"
        | "failed"
        | "cancelled"
        | undefined,
      boardPublicId: jobBoard || undefined,
      limit: 20,
    },
    { enabled: Boolean(activeWorkspace), refetchInterval: 5000 },
  );
  const cancelMutation = api.agent.cancel.useMutation({
    onSuccess: () => void jobs.refetch(),
    onError: (err) => toast(err.message, "error"),
  });
  const customList = api.agent.listCustomWorkers.useQuery(
    { workspacePublicId: activeWorkspace?.publicId ?? "" },
    { enabled: Boolean(activeWorkspace) },
  );
  const createCustom = api.agent.createCustomWorker.useMutation({
    onSuccess: () => {
      toast("Custom worker created", "success");
      setCreateOpen(false);
      setDraft({
        name: "",
        title: "",
        avatar: "✨",
        description: "",
        systemPrompt: "",
        outputMode: "freeform",
        schemaWorker: "",
      });
      void utils.agent.listCustomWorkers.invalidate();
    },
    onError: (err) => toast(err.message, "error"),
  });
  const updateCustom = api.agent.updateCustomWorker.useMutation({
    onSuccess: () => {
      toast("Custom worker updated", "success");
      setCreateOpen(false);
      setEditingWorker(null);
      void utils.agent.listCustomWorkers.invalidate();
    },
    onError: (err) => toast(err.message, "error"),
  });
  const deleteCustom = api.agent.deleteCustomWorker.useMutation({
    onSettled: () => void utils.agent.listCustomWorkers.invalidate(),
    onError: (err) => toast(err.message, "error"),
  });
  const emptyDraft = {
    name: "",
    title: "",
    avatar: "✨",
    description: "",
    systemPrompt: "",
    outputMode: "freeform",
    schemaWorker: "",
  };
  const openForEdit = (w: {
    publicId: string;
    name: string;
    title: string;
    avatar: string;
    description?: string | null;
    systemPrompt: string;
    outputMode: string;
    schemaWorker?: string | null;
  }) => {
    setEditingWorker(w.publicId);
    setDraft({
      name: w.name,
      title: w.title,
      avatar: w.avatar,
      description: w.description ?? "",
      systemPrompt: w.systemPrompt,
      outputMode: w.outputMode,
      schemaWorker: w.schemaWorker ?? "",
    });
    setCreateOpen(true);
  };
  /** Persona pack import: parse + validate client-side, prefill the
   * create form for review — never auto-create. */
  const importPersona = (file: File) => {
    void file.text().then((text) => {
      try {
        const data = JSON.parse(text) as Record<string, unknown>;
        if (
          data.kind !== "kr8kan-persona/v1" ||
          typeof data.name !== "string" ||
          typeof data.title !== "string" ||
          typeof data.systemPrompt !== "string"
        ) {
          toast("Not a valid kr8kan-persona/v1 file", "error");
          return;
        }
        setEditingWorker(null);
        setDraft({
          name: data.name,
          title: data.title,
          avatar: typeof data.avatar === "string" ? data.avatar : "✨",
          description: typeof data.description === "string" ? data.description : "",
          systemPrompt: data.systemPrompt,
          outputMode: data.outputMode === "schema" ? "schema" : "freeform",
          schemaWorker:
            typeof data.schemaWorker === "string" ? data.schemaWorker : "",
        });
        setCreateOpen(true);
        toast("Persona loaded — review and create", "success");
      } catch {
        toast("Could not parse that file as JSON", "error");
      }
    });
  };
  const exportWorker = (w: {
    name: string;
    title: string;
    avatar: string;
    description?: string | null;
    systemPrompt: string;
    needs: string;
    outputMode: string;
    schemaWorker?: string | null;
  }) => {
    const blob = new Blob(
      [JSON.stringify({ kind: "kr8kan-persona/v1", ...w }, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${w.name}.persona.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const projectRoots = (workers.data?.projectRoots ?? []) as string[];

  return (
    <SettingsLayout title="AI workers">
      <div className="max-w-2xl space-y-6">
        {/* Health */}
        <div className="rounded-kr8-md border border-kr8-border bg-kr8-bg-elevated p-4">
          <div className="flex items-center gap-2">
            {health.data?.ok ? (
              <HiCheckCircle className="h-5 w-5 text-kr8-success" />
            ) : (
              <HiXCircle className="h-5 w-5 text-kr8-danger" />
            )}
            <h2 className="text-[15px] font-semibold">
              Pi runtime {health.data?.ok ? "healthy" : "unavailable"}
            </h2>
            <div className="flex-1" />
            <Button size="sm" variant="secondary" onClick={() => setTestOpen(true)}>
              Test worker
            </Button>
          </div>
          <dl className="mt-3 grid grid-cols-1 gap-2 text-[13px] sm:grid-cols-2">
            <div>
              <dt className="text-kr8-fg-muted">PI_BIN</dt>
              <dd className="font-mono">{health.data?.piBin ?? "…"}</dd>
            </div>
            <div>
              <dt className="text-kr8-fg-muted">Agent home</dt>
              <dd className="font-mono">{health.data?.agentHome ?? "…"}</dd>
            </div>
            <div>
              <dt className="text-kr8-fg-muted">Workers enabled</dt>
              <dd>{health.data?.enabled ? "yes" : "no (KR8KAN_PI_WORKERS_ENABLED)"}</dd>
            </div>
            <div>
              <dt className="text-kr8-fg-muted">Tools allowed</dt>
              <dd>
                {workers.data?.toolsAllowed
                  ? "yes (KR8KAN_PI_ALLOW_TOOLS)"
                  : "no — advisory only"}
              </dd>
            </div>
            <div>
              <dt className="text-kr8-fg-muted">Runner mode</dt>
              <dd className="font-mono">
                {health.data?.runnerMode ?? "in-process"} · max{" "}
                {workers.data?.maxConcurrent ?? 4} concurrent
              </dd>
            </div>
            <div>
              <dt className="text-kr8-fg-muted">
                Project roots ({projectRoots.length})
              </dt>
              <dd className="font-mono">
                {projectRoots.length ? projectRoots.join(", ") : "none configured"}
              </dd>
            </div>
            {health.data?.detail && (
              <div>
                <dt className="text-kr8-fg-muted">Detail</dt>
                <dd className="text-kr8-danger">{health.data.detail}</dd>
              </div>
            )}
          </dl>
          <p className="mt-3 text-[12px] text-kr8-fg-muted">
            Workers run through your global ~/.pi agent layer — models and
            providers are whatever you configured there. No AI SaaS is baked
            into Kr8Kan. Jobs are stored in the database, workspace-scoped.
            Agents need a long-lived Node process (runner is in-process — no
            serverless / multi-instance deploys).
          </p>
          <details className="mt-2 text-[12px] text-kr8-fg-muted">
            <summary className="cursor-pointer">
              How to enable the dev agent (tools)
            </summary>
            <ol className="ml-4 mt-1 list-decimal space-y-1">
              <li>
                Install the pi CLI and configure a provider in <code>~/.pi</code>{" "}
                (or set <code>PI_BIN</code> / <code>PI_AGENT_HOME</code>).
              </li>
              <li>
                Set <code>KR8KAN_PI_ALLOW_TOOLS=true</code>.
              </li>
              <li>
                Allowlist project folders:{" "}
                <code>KR8KAN_PI_PROJECT_ROOTS=/abs/path1:/abs/path2</code>.
              </li>
              <li>Link a folder inside a root in the board's settings.</li>
              <li>
                Optional: set a verify command in board settings — it runs
                after each dev-task and badges the job pass/fail.
              </li>
            </ol>
          </details>
        </div>

        {/* Worker catalogue */}
        <section>
          <h2 className="mb-2 text-[15px] font-semibold">Workers</h2>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(
              workers.data?.workers as
                | {
                    name: string;
                    title: string;
                    description: string;
                    needs: string;
                    allowTools?: boolean;
                  }[]
                | undefined
            )?.map((worker) => (
              <li
                key={worker.name}
                className="rounded-kr8-md border border-kr8-border bg-kr8-bg-elevated p-3"
              >
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <HiOutlineSparkles className="h-4 w-4 text-kr8-accent" />
                  {worker.title}
                  {worker.allowTools && (
                    <span className="rounded-full bg-kr8-warning/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-kr8-warning">
                      tools
                    </span>
                  )}
                  <Badge className="ml-auto">{worker.needs}</Badge>
                </div>
                <p className="mt-1 text-[13px] text-kr8-fg-muted">
                  {worker.description}
                </p>
              </li>
            ))}
          </ul>
        </section>

        {/* Custom workers (persona packs) */}
        <section>
          <div className="mb-2 flex items-center gap-2">
            <h2 className="text-[15px] font-semibold">Custom workers</h2>
            <div className="flex-1" />
            <label className="cursor-pointer">
              <input
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) importPersona(file);
                  e.target.value = "";
                }}
              />
              <span className="inline-flex min-h-[36px] items-center rounded-kr8-sm border border-kr8-border px-3 text-[13px] font-medium hover:bg-kr8-bg-muted">
                Import
              </span>
            </label>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setEditingWorker(null);
                setDraft(emptyDraft);
                setCreateOpen(true);
              }}
            >
              Create worker
            </Button>
          </div>
          <ul className="space-y-2">
            {((customList.data ?? []) as {
              publicId: string;
              name: string;
              title: string;
              avatar: string;
              description?: string | null;
              systemPrompt: string;
              needs: string;
              outputMode: string;
              schemaWorker?: string | null;
            }[]).map((w) => (
              <li
                key={w.publicId}
                className="flex flex-wrap items-center gap-2 rounded-kr8-md border border-kr8-border bg-kr8-bg-elevated px-3 py-2.5"
              >
                <AgentAvatar
                  agent={{ publicId: w.publicId, displayName: w.title, avatar: w.avatar }}
                  size="sm"
                />
                <span className="text-sm font-medium">{w.title}</span>
                <span className="font-mono text-[11px] text-kr8-fg-muted">@{w.name}</span>
                {w.outputMode === "schema" && (
                  <Badge tone="accent">applies as {w.schemaWorker}</Badge>
                )}
                <div className="ml-auto flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => openForEdit(w)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => exportWorker(w)}>
                    Export
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-kr8-danger"
                    onClick={() => deleteCustom.mutate({ workerPublicId: w.publicId })}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ))}
            {customList.data?.length === 0 && (
              <p className="text-sm text-kr8-fg-muted">
                None yet — mint a worker with its own personality; mention it with
                @name on any card. Advisory only, never tools.
              </p>
            )}
          </ul>
        </section>

        {/* Job history */}
        <section>
          <h2 className="mb-2 text-[15px] font-semibold">Recent jobs</h2>
          <div className="mb-2 flex flex-wrap gap-2">
            <select
              aria-label="Filter by worker"
              className="min-h-[36px] rounded-kr8-sm border border-kr8-border bg-kr8-bg px-2 text-[13px]"
              value={jobWorker}
              onChange={(e) => setJobWorker(e.target.value)}
            >
              <option value="">All workers</option>
              {[
                ...(((workers.data?.workers ?? []) as { name: string }[]).map(
                  (w) => w.name,
                )),
                ...(((customList.data ?? []) as { name: string }[]).map(
                  (w) => w.name,
                )),
              ].map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter by status"
              className="min-h-[36px] rounded-kr8-sm border border-kr8-border bg-kr8-bg px-2 text-[13px]"
              value={jobStatus}
              onChange={(e) => setJobStatus(e.target.value)}
            >
              <option value="">All statuses</option>
              {["pending", "running", "completed", "failed", "cancelled"].map(
                (s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ),
              )}
            </select>
            <select
              aria-label="Filter by board"
              className="min-h-[36px] rounded-kr8-sm border border-kr8-border bg-kr8-bg px-2 text-[13px]"
              value={jobBoard}
              onChange={(e) => setJobBoard(e.target.value)}
            >
              <option value="">All boards</option>
              {((boards.data ?? []) as { publicId: string; name: string }[]).map(
                (b) => (
                  <option key={b.publicId} value={b.publicId}>
                    {b.name}
                  </option>
                ),
              )}
            </select>
          </div>
          <ul className="space-y-2">
            {jobs.data?.map(
              (job: {
                id: string;
                worker: string;
                status: string;
                createdAt: string;
                result?: string;
                error?: string;
                progress?: string;
                verifyStatus?: string;
              }) => (
                <li
                  key={job.id}
                  className="rounded-kr8-md border border-kr8-border bg-kr8-bg-elevated"
                >
                  <div className="flex min-h-[48px] w-full items-center gap-3 px-3 py-2">
                    <button
                      onClick={() =>
                        setExpandedJob(expandedJob === job.id ? null : job.id)
                      }
                      className="flex flex-1 items-center gap-3 text-left"
                    >
                      <Badge
                        tone={
                          job.status === "completed"
                            ? "success"
                            : job.status === "failed"
                              ? "danger"
                              : job.status === "running"
                                ? "accent"
                                : "neutral"
                        }
                      >
                        {job.status}
                      </Badge>
                      <span className="text-sm font-medium">{job.worker}</span>
                      <span className="font-mono text-[11px] text-kr8-fg-muted">
                        {job.id}
                      </span>
                      {job.verifyStatus && (
                        <Badge
                          tone={job.verifyStatus === "pass" ? "success" : "danger"}
                        >
                          verify {job.verifyStatus}
                        </Badge>
                      )}
                      <span className="ml-auto text-[12px] text-kr8-fg-muted">
                        {relativeTime(job.createdAt)}
                      </span>
                    </button>
                    {(job.status === "running" || job.status === "pending") && (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={cancelMutation.isPending}
                        onClick={() => cancelMutation.mutate({ jobId: job.id })}
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                  {expandedJob === job.id && (
                    <div className="border-t border-kr8-border px-3 py-3">
                      {job.progress &&
                        (job.status === "running" || job.status === "pending") && (
                          <p className="mb-2 truncate font-mono text-[12px] text-kr8-fg-muted">
                            {job.progress}
                          </p>
                        )}
                      {job.error && (
                        <p className="mb-2 text-[13px] text-kr8-danger">{job.error}</p>
                      )}
                      {job.result ? (
                        <div
                          className="prose prose-sm max-h-80 max-w-none overflow-y-auto dark:prose-invert"
                          dangerouslySetInnerHTML={{
                            __html: miniMarkdown(job.result),
                          }}
                        />
                      ) : (
                        !job.error && (
                          <p className="text-[13px] text-kr8-fg-muted">
                            No output (yet).
                          </p>
                        )
                      )}
                    </div>
                  )}
                </li>
              ),
            )}
            {jobs.data?.length === 0 && (
              <p className="text-sm text-kr8-fg-muted">
                No jobs yet — run one from a board's AI worker menu.
              </p>
            )}
          </ul>
        </section>
      </div>

      <WorkerRunner open={testOpen} onClose={() => setTestOpen(false)} />

      <Modal
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setEditingWorker(null);
        }}
        title={editingWorker ? "Edit custom worker" : "Create custom worker"}
      >
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              label="Avatar"
              value={draft.avatar}
              onChange={(e) => setDraft({ ...draft, avatar: e.target.value })}
              className="w-16"
            />
            <Input
              label="Mention name (slug)"
              placeholder="release-scribe"
              value={draft.name}
              disabled={Boolean(editingWorker)}
              hint={editingWorker ? "Slug is immutable — it's the @mention handle." : undefined}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </div>
          <Input
            label="Display title"
            placeholder="Release Scribe"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
          <Input
            label="Description (optional)"
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
          <Textarea
            label="System prompt (personality + task — the output contract is injected automatically when a schema is borrowed)"
            rows={6}
            value={draft.systemPrompt}
            onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })}
          />
          <label className="block text-[13px]">
            <span className="mb-1 block text-kr8-fg-muted">Output</span>
            <select
              className="min-h-[44px] w-full rounded-kr8-sm border border-kr8-border bg-kr8-bg px-2 text-sm"
              value={draft.outputMode === "schema" ? draft.schemaWorker : "freeform"}
              onChange={(e) => {
                const v = e.target.value;
                setDraft(
                  v === "freeform"
                    ? { ...draft, outputMode: "freeform", schemaWorker: "" }
                    : { ...draft, outputMode: "schema", schemaWorker: v },
                );
              }}
            >
              <option value="freeform">Freeform (comment/copy only)</option>
              <option value="draft-card">Drafts cards (applies like draft-card)</option>
              <option value="triage-card">Triages (applies like triage-card)</option>
              <option value="breakdown-card">Breaks down (applies like breakdown-card)</option>
              <option value="standup">Standup sections</option>
              <option value="summarize-board">Board summary</option>
            </select>
          </label>
          <Button
            fullWidth
            loading={createCustom.isPending || updateCustom.isPending}
            disabled={!draft.name || !draft.title || draft.systemPrompt.length < 20}
            onClick={() => {
              if (editingWorker) {
                updateCustom.mutate({
                  workerPublicId: editingWorker,
                  title: draft.title.trim(),
                  avatar: draft.avatar || "✨",
                  description: draft.description || null,
                  systemPrompt: draft.systemPrompt,
                  outputMode: draft.outputMode as "freeform" | "schema",
                  schemaWorker: draft.schemaWorker
                    ? (draft.schemaWorker as "draft-card")
                    : null,
                });
              } else {
                createCustom.mutate({
                  workspacePublicId: activeWorkspace?.publicId ?? "",
                  name: draft.name.trim().toLowerCase(),
                  title: draft.title.trim(),
                  avatar: draft.avatar || "✨",
                  description: draft.description || undefined,
                  systemPrompt: draft.systemPrompt,
                  outputMode: draft.outputMode as "freeform" | "schema",
                  schemaWorker: draft.schemaWorker
                    ? (draft.schemaWorker as "draft-card")
                    : undefined,
                });
              }
            }}
          >
            {editingWorker ? "Save changes" : "Create worker"}
          </Button>
        </div>
      </Modal>
    </SettingsLayout>
  );
}
