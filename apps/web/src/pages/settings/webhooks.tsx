import { useState } from "react";
import { HiPlus } from "react-icons/hi2";

import { Badge } from "~/components/Badge";
import { Button } from "~/components/Button";
import { Input } from "~/components/Input";
import { SettingsLayout } from "~/components/SettingsLayout";
import { useToast } from "~/providers/toast";
import { useWorkspace } from "~/providers/workspace";
import { api } from "~/utils/api";

export default function WebhooksSettingsPage() {
  const { activeWorkspace } = useWorkspace();
  const { toast } = useToast();
  const utils = api.useUtils();
  const [url, setUrl] = useState("");

  const workspaceId = activeWorkspace?.publicId ?? "";
  const webhooks = api.webhook.list.useQuery(
    { workspacePublicId: workspaceId },
    { enabled: Boolean(activeWorkspace) },
  );
  const refresh = () => void utils.webhook.list.invalidate();

  const create = api.webhook.create.useMutation({
    onSuccess: () => {
      refresh();
      setUrl("");
      toast("Webhook added", "success");
    },
    onError: (err) => toast(err.message, "error"),
  });
  const update = api.webhook.update.useMutation({ onSettled: refresh });
  const remove = api.webhook.delete.useMutation({ onSettled: refresh });

  return (
    <SettingsLayout title="Webhooks">
      <div className="max-w-2xl space-y-5">
        <p className="text-sm text-kr8-fg-muted">
          Kr8Kan POSTs card events (card.created, card.moved) as JSON to your
          URLs — local hooks, chat bridges, whatever you run. This replaces any
          cloud notification service.
        </p>
        <p className="text-[12px] text-kr8-fg-muted">
          Slack tip: paste a hooks.slack.com incoming-webhook URL and events
          arrive as formatted Slack messages (Block Kit) automatically — gates
          show as “Approval needed” with a link back to the card.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) {
              create.mutate({
                workspacePublicId: workspaceId,
                url: url.trim(),
                events: [],
              });
            }
          }}
          className="flex items-end gap-2"
        >
          <div className="flex-1">
            <Input
              label="Endpoint URL"
              type="url"
              placeholder="http://localhost:8787/kr8kan-hook"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <Button type="submit" loading={create.isPending} iconLeft={<HiPlus className="h-4 w-4" />}>
            Add
          </Button>
        </form>

        <ul className="space-y-2">
          {webhooks.data?.map((hook) => (
            <li
              key={hook.publicId}
              className="flex items-center gap-3 rounded-kr8-md border border-kr8-border bg-kr8-bg-elevated p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-[12px]">{hook.url}</p>
                <p className="text-[12px] text-kr8-fg-muted">
                  {hook.events.length === 0 ? "all events" : hook.events.join(", ")}
                </p>
              </div>
              <Badge tone={hook.enabled ? "success" : "neutral"}>
                {hook.enabled ? "enabled" : "paused"}
              </Badge>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  update.mutate({
                    webhookPublicId: hook.publicId,
                    enabled: !hook.enabled,
                  })
                }
              >
                {hook.enabled ? "Pause" : "Enable"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-kr8-danger"
                onClick={() => remove.mutate({ webhookPublicId: hook.publicId })}
              >
                Delete
              </Button>
            </li>
          ))}
          {webhooks.data?.length === 0 && (
            <p className="text-sm text-kr8-fg-muted">No webhooks yet.</p>
          )}
        </ul>
      </div>
    </SettingsLayout>
  );
}
