import { Badge } from "~/components/Badge";
import { SettingsLayout } from "~/components/SettingsLayout";
import { api } from "~/utils/api";

export default function IntegrationsSettingsPage() {
  const integrations = api.integration.list.useQuery();
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
      </div>
    </SettingsLayout>
  );
}
