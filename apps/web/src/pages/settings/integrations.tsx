import { Badge } from "~/components/Badge";
import { Button } from "~/components/Button";
import { SettingsLayout } from "~/components/SettingsLayout";
import { useToast } from "~/providers/toast";
import { useWorkspace } from "~/providers/workspace";
import { api } from "~/utils/api";

export default function IntegrationsSettingsPage() {
  const { activeWorkspace } = useWorkspace();
  const { toast } = useToast();
  const integrations = api.integration.list.useQuery();
  const infra = api.integration.infra.useQuery();

  const testEmail = api.integration.testEmail.useMutation({
    onSuccess: (result) => {
      if (result.sent) {
        toast("Test email sent — check your inbox", "success");
      } else {
        toast(result.reason ?? "Test email not sent", "error");
      }
    },
    onError: (err) => toast(err.message, "error"),
  });

  const smtpConfigured = infra.data?.smtp.configured ?? false;

  return (
    <SettingsLayout title="Integrations">
      <div className="max-w-2xl space-y-3">
        <p className="text-sm text-kr8-fg-muted">
          Everything integrates through local-first surfaces: the REST API,
          workspace webhooks, the optional MCP server, and Pi workers. No
          third-party SaaS connectors are required.
        </p>
        <ul className="space-y-2">
          {integrations.data?.integrations.map((item) => (
            <li
              key={item.key}
              className="flex items-center gap-3 rounded-kr8-md border border-kr8-border bg-kr8-bg-elevated p-4"
            >
              <div className="flex-1">
                <p className="text-sm font-semibold">{item.name}</p>
                <p className="text-[13px] text-kr8-fg-muted">{item.detail}</p>
              </div>
              <Badge tone="success">{item.status}</Badge>
            </li>
          ))}
        </ul>

        <p className="pt-2 text-sm text-kr8-fg-muted">
          Outbound email and attachment storage are configured entirely via
          server env vars — there's no in-app form for secrets. This just
          shows whether they're set.
        </p>
        <ul className="space-y-2">
          <li className="flex items-center gap-3 rounded-kr8-md border border-kr8-border bg-kr8-bg-elevated p-4">
            <div className="flex-1">
              <p className="text-sm font-semibold">SMTP</p>
              <p className="text-[13px] text-kr8-fg-muted">
                {smtpConfigured
                  ? `Configured — ${infra.data?.smtp.host}`
                  : "Not configured — set SMTP_HOST and related SMTP_* env vars."}
              </p>
            </div>
            <Badge tone={smtpConfigured ? "success" : "neutral"}>
              {smtpConfigured ? "configured" : "not configured"}
            </Badge>
            <Button
              size="sm"
              variant="ghost"
              loading={testEmail.isPending}
              disabled={!smtpConfigured || !activeWorkspace}
              title={
                smtpConfigured
                  ? undefined
                  : "Set SMTP_* env vars to enable test sends"
              }
              onClick={() =>
                activeWorkspace &&
                testEmail.mutate({ workspacePublicId: activeWorkspace.publicId })
              }
            >
              Send test email
            </Button>
          </li>
          <li className="flex items-center gap-3 rounded-kr8-md border border-kr8-border bg-kr8-bg-elevated p-4">
            <div className="flex-1">
              <p className="text-sm font-semibold">S3-compatible storage</p>
              <p className="text-[13px] text-kr8-fg-muted">
                {infra.data?.s3.configured
                  ? "Configured — attachment uploads are enabled."
                  : "Not configured — set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY."}
              </p>
            </div>
            <Badge tone={infra.data?.s3.configured ? "success" : "neutral"}>
              {infra.data?.s3.configured ? "configured" : "not configured"}
            </Badge>
          </li>
        </ul>
      </div>
    </SettingsLayout>
  );
}
