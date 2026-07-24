import { useState } from "react";
import { HiCheckCircle, HiShieldCheck, HiXCircle } from "react-icons/hi2";

import { Badge } from "~/components/Badge";
import { Button } from "~/components/Button";
import { Input } from "~/components/Input";
import { SettingsLayout } from "~/components/SettingsLayout";
import { useToast } from "~/providers/toast";
import { useWorkspace } from "~/providers/workspace";
import { api } from "~/utils/api";
import { formatDateTime } from "~/utils/format";

/**
 * Workspace audit log (Buzz-inspired hash chain): every human + agent
 * mutation in one tamper-evident sequence, with on-demand verification.
 */
export default function AuditSettingsPage() {
  const { activeWorkspace } = useWorkspace();
  const { toast } = useToast();
  const [eventType, setEventType] = useState("");
  const [entity, setEntity] = useState("");
  const [verifyResult, setVerifyResult] = useState<{
    ok: boolean;
    checked: number;
    brokenAtSeq?: number;
  } | null>(null);

  const log = api.workspace.auditLog.useQuery(
    {
      workspacePublicId: activeWorkspace?.publicId ?? "",
      eventType: eventType.trim() || undefined,
      entityPublicId: entity.trim() || undefined,
      limit: 100,
    },
    { enabled: Boolean(activeWorkspace) },
  );
  const verify = api.workspace.auditVerify.useMutation({
    onSuccess: (result) => setVerifyResult(result),
    onError: (err) => toast(err.message, "error"),
  });

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(log.data ?? [], null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kr8kan-audit-${activeWorkspace?.slug ?? "workspace"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <SettingsLayout title="Audit log">
      <div className="max-w-3xl space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <Input
            label="Event type"
            placeholder="agent.applied"
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
          />
          <Input
            label="Entity id"
            placeholder="card / job publicId"
            value={entity}
            onChange={(e) => setEntity(e.target.value)}
          />
          <div className="flex-1" />
          <Button variant="secondary" onClick={exportJson}>
            Export JSON
          </Button>
          <Button
            loading={verify.isPending}
            iconLeft={<HiShieldCheck className="h-4 w-4" />}
            onClick={() =>
              verify.mutate({
                workspacePublicId: activeWorkspace?.publicId ?? "",
              })
            }
          >
            Verify integrity
          </Button>
        </div>

        {verifyResult && (
          <p
            className={
              verifyResult.ok
                ? "flex items-center gap-2 rounded-kr8-sm border border-kr8-success/40 bg-kr8-success/10 p-3 text-[13px] text-kr8-success"
                : "flex items-center gap-2 rounded-kr8-sm border border-kr8-danger/40 bg-kr8-danger/10 p-3 text-[13px] text-kr8-danger"
            }
          >
            {verifyResult.ok ? (
              <HiCheckCircle className="h-5 w-5" />
            ) : (
              <HiXCircle className="h-5 w-5" />
            )}
            {verifyResult.ok
              ? `Chain intact — ${verifyResult.checked} entries verified.`
              : `Chain BROKEN at seq ${verifyResult.brokenAtSeq} — entries from there on cannot be trusted.`}
          </p>
        )}

        <ul className="space-y-1.5">
          {(log.data ?? []).map(
            (entry: {
              seq: number;
              eventType: string;
              entityType: string;
              entityPublicId: string | null;
              actorUserId: string | null;
              actorAgentId: number | null;
              createdAt: string;
              hash: string;
              payload?: unknown;
            }) => (
              <li
                key={entry.seq}
                className="flex flex-wrap items-center gap-2 rounded-kr8-sm border border-kr8-border bg-kr8-bg-elevated px-3 py-2 text-[13px]"
              >
                <span className="w-10 font-mono text-[11px] text-kr8-fg-muted">
                  #{entry.seq}
                </span>
                <Badge tone={entry.actorAgentId ? "accent" : "neutral"}>
                  {entry.actorAgentId ? "agent" : "human"}
                </Badge>
                <span className="font-medium">{entry.eventType}</span>
                {entry.entityPublicId && (
                  <span className="font-mono text-[11px] text-kr8-fg-muted">
                    {entry.entityType}:{entry.entityPublicId}
                  </span>
                )}
                <span className="ml-auto text-[11px] text-kr8-fg-muted">
                  {formatDateTime(entry.createdAt)}
                </span>
                <span
                  className="font-mono text-[10px] text-kr8-fg-muted/60"
                  title={entry.hash}
                >
                  {entry.hash.slice(0, 8)}
                </span>
              </li>
            ),
          )}
          {log.data?.length === 0 && (
            <p className="text-sm text-kr8-fg-muted">
              No audit entries yet — they accrue as the workspace is used.
            </p>
          )}
        </ul>
      </div>
    </SettingsLayout>
  );
}
