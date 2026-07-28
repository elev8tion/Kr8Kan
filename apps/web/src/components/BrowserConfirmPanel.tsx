import { useEffect, useState } from "react";

import { Button } from "~/components/Button";
import { useToast } from "~/providers/toast";
import { useWorkspace } from "~/providers/workspace";
import { api } from "~/utils/api";

/**
 * Pending browser-action confirmations for the active workspace.
 *
 * A gated browser command parks server-side for at most 120s and is DENIED
 * on expiry, so this panel is the only window in which a human can say
 * yes. It renders above the page content whenever anything is pending —
 * a blocked agent must never be buried below a long page — and stays
 * mounted (empty) otherwise so the poll keeps watching.
 *
 * Affordances are deliberately asymmetric: deny is the cheap, safe,
 * keyboard-reachable default; approve is a solid button labeled with its
 * real scope ("Allow once") and needs agent:manage server-side.
 */

interface PendingConfirm {
  requestId: string;
  jobId: string;
  summary: string;
  url: string;
  ruleName: string;
  reason: string;
  requestedAt: string;
  expiresAt: string;
}

const POLL_MS = 5_000;

function originOf(url: string): { origin: string; rest: string } | null {
  try {
    const u = new URL(url);
    return { origin: u.host, rest: url.slice(url.indexOf(u.host) + u.host.length) };
  } catch {
    return null;
  }
}

function Countdown({ expiresAt }: { expiresAt: string }) {
  const [left, setLeft] = useState(() =>
    Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000)),
  );
  useEffect(() => {
    const t = setInterval(
      () =>
        setLeft(Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000))),
      1000,
    );
    return () => clearInterval(t);
  }, [expiresAt]);
  return (
    <span
      className={
        left <= 15
          ? "text-[12px] font-medium text-kr8-danger"
          : "text-[12px] text-kr8-fg-muted"
      }
    >
      auto-denies in {left}s
    </span>
  );
}

export function BrowserConfirmPanel() {
  const { activeWorkspace } = useWorkspace();
  const { toast } = useToast();
  const utils = api.useUtils();

  const confirms = api.agent.browserConfirms.useQuery(
    { workspacePublicId: activeWorkspace?.publicId ?? "" },
    { enabled: Boolean(activeWorkspace), refetchInterval: POLL_MS },
  );
  const respond = api.agent.browserConfirm.useMutation({
    onSuccess: (outcome, vars) => {
      if (!outcome.matched) {
        toast("Request already resolved or expired", "info");
      } else {
        toast(vars.approved ? "Action allowed once" : "Action denied", "success");
      }
      void utils.agent.browserConfirms.invalidate();
    },
    onError: (err) => toast(err.message, "error"),
  });

  const pending = (confirms.data ?? []) as PendingConfirm[];
  if (pending.length === 0) return null;

  return (
    <section
      aria-label={`${pending.length} browser actions awaiting approval`}
      className="mx-auto mb-4 w-full max-w-4xl space-y-2 px-4 pt-4 md:px-0 md:pt-0"
    >
      {pending.map((p) => {
        const parsed = originOf(p.url);
        const busy = respond.isPending && respond.variables?.requestId === p.requestId;
        return (
          <div
            key={p.requestId}
            className="rounded-kr8-md border border-kr8-warning/40 bg-kr8-bg-elevated p-3 shadow-kr8-sm"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-kr8-warning/15 px-2 py-0.5 text-[11px] font-medium text-kr8-warning">
                Approval needed
              </span>
              <p className="min-w-0 flex-1 text-sm">
                Safety rule <strong>{p.ruleName}</strong> requires approval
                before this browser action runs.
              </p>
              <Countdown expiresAt={p.expiresAt} />
            </div>
            <div className="mt-2 space-y-0.5 font-mono text-[12px] text-kr8-fg-muted">
              <p className="break-all">{p.summary}</p>
              <p className="break-all">
                {parsed ? (
                  <>
                    <span className="font-semibold text-kr8-fg">{parsed.origin}</span>
                    {parsed.rest}
                  </>
                ) : (
                  p.url || "(no url)"
                )}
              </p>
              {p.reason && <p className="opacity-80">{p.reason}</p>}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                className="border-kr8-danger/50 text-kr8-danger"
                loading={busy && respond.variables?.approved === false}
                onClick={() =>
                  respond.mutate({ requestId: p.requestId, approved: false })
                }
              >
                Deny
              </Button>
              <Button
                size="sm"
                loading={busy && respond.variables?.approved === true}
                onClick={() =>
                  respond.mutate({ requestId: p.requestId, approved: true })
                }
              >
                Allow once
              </Button>
              <span className="ml-auto text-[11px] text-kr8-fg-muted">
                job {p.jobId}
              </span>
            </div>
          </div>
        );
      })}
    </section>
  );
}
