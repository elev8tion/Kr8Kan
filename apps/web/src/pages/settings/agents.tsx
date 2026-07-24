import { useState } from "react";
import {
  HiCheckCircle,
  HiOutlineSparkles,
  HiXCircle,
} from "react-icons/hi2";

import { Badge } from "~/components/Badge";
import { Button } from "~/components/Button";
import { SettingsLayout } from "~/components/SettingsLayout";
import { WorkerRunner } from "~/components/WorkerRunner";
import { api } from "~/utils/api";
import { miniMarkdown, relativeTime } from "~/utils/format";

export default function AgentsSettingsPage() {
  const [testOpen, setTestOpen] = useState(false);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);

  const health = api.agent.health.useQuery();
  const workers = api.agent.listWorkers.useQuery();
  const jobs = api.agent.jobs.useQuery({ limit: 20 });

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
            into Kr8Kan. Jobs and results live in .kr8kan/jobs.
          </p>
        </div>

        {/* Worker catalogue */}
        <section>
          <h2 className="mb-2 text-[15px] font-semibold">Workers</h2>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(
              workers.data?.workers as
                | { name: string; title: string; description: string; needs: string }[]
                | undefined
            )?.map((worker) => (
              <li
                key={worker.name}
                className="rounded-kr8-md border border-kr8-border bg-kr8-bg-elevated p-3"
              >
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <HiOutlineSparkles className="h-4 w-4 text-kr8-accent" />
                  {worker.title}
                  <Badge className="ml-auto">{worker.needs}</Badge>
                </div>
                <p className="mt-1 text-[13px] text-kr8-fg-muted">
                  {worker.description}
                </p>
              </li>
            ))}
          </ul>
        </section>

        {/* Job history */}
        <section>
          <h2 className="mb-2 text-[15px] font-semibold">Recent jobs</h2>
          <ul className="space-y-2">
            {jobs.data?.map(
              (job: {
                id: string;
                worker: string;
                status: string;
                createdAt: string;
                result?: string;
                error?: string;
              }) => (
                <li
                  key={job.id}
                  className="rounded-kr8-md border border-kr8-border bg-kr8-bg-elevated"
                >
                  <button
                    onClick={() =>
                      setExpandedJob(expandedJob === job.id ? null : job.id)
                    }
                    className="flex min-h-[48px] w-full items-center gap-3 px-3 py-2 text-left"
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
                    <span className="ml-auto text-[12px] text-kr8-fg-muted">
                      {relativeTime(job.createdAt)}
                    </span>
                  </button>
                  {expandedJob === job.id && (
                    <div className="border-t border-kr8-border px-3 py-3">
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
    </SettingsLayout>
  );
}
