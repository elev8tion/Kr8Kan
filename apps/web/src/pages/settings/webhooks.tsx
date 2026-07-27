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
  // Revealed secrets, keyed by webhook publicId. Only ever populated from a
  // create/rotate response — never fetched or persisted — so the value
  // disappears as soon as the page is reloaded or the user navigates away.
  const [revealedSecrets, setRevealedSecrets] = useState<
    Record<string, string>
  >({});

  const workspaceId = activeWorkspace?.publicId ?? "";
  const webhooks = api.webhook.list.useQuery(
    { workspacePublicId: workspaceId },
    { enabled: Boolean(activeWorkspace) },
  );
  const refresh = () => void utils.webhook.list.invalidate();

  const create = api.webhook.create.useMutation({
    onSuccess: (hook) => {
      refresh();
      setUrl("");
      if (hook.secret) {
        setRevealedSecrets((prev) => ({ ...prev, [hook.publicId]: hook.secret! }));
      }
      toast("Webhook added", "success");
    },
    onError: (err) => toast(err.message, "error"),
  });
  const update = api.webhook.update.useMutation({ onSettled: refresh });
  const remove = api.webhook.delete.useMutation({ onSettled: refresh });
  const rotateSecret = api.webhook.rotateSecret.useMutation({
    onSuccess: (hook) => {
      refresh();
      if (hook.secret) {
        setRevealedSecrets((prev) => ({ ...prev, [hook.publicId]: hook.secret! }));
      }
      toast("Signing secret rotated", "success");
    },
    onError: (err) => toast(err.message, "error"),
  });

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
          {webhooks.data?.map((hook) => {
            const revealed = revealedSecrets[hook.publicId];
            return (
              <li
                key={hook.publicId}
                className="space-y-2 rounded-kr8-md border border-kr8-border bg-kr8-bg-elevated p-3"
              >
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-[12px]">{hook.url}</p>
                    <p className="text-[12px] text-kr8-fg-muted">
                      {hook.events.length === 0
                        ? "all events"
                        : hook.events.join(", ")}
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
                    loading={
                      rotateSecret.isPending &&
                      rotateSecret.variables?.webhookPublicId === hook.publicId
                    }
                    onClick={() => {
                      const message = hook.hasSecret
                        ? "Rotate the signing secret? The old secret stops verifying deliveries immediately."
                        : "Generate a signing secret for this webhook?";
                      if (window.confirm(message)) {
                        rotateSecret.mutate({ webhookPublicId: hook.publicId });
                      }
                    }}
                  >
                    {hook.hasSecret ? "Rotate secret" : "Generate secret"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-kr8-danger"
                    onClick={() =>
                      remove.mutate({ webhookPublicId: hook.publicId })
                    }
                  >
                    Delete
                  </Button>
                </div>

                {revealed ? (
                  <div className="rounded-kr8-md border border-kr8-warning/40 bg-kr8-warning/10 p-2">
                    <p className="text-[12px] font-medium text-kr8-warning">
                      Store this signing secret now — it will not be shown
                      again.
                    </p>
                    <code className="mt-1 block truncate rounded bg-kr8-bg-canvas px-2 py-1 font-mono text-[12px] select-all">
                      {revealed}
                    </code>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setRevealedSecrets((prev) => {
                          const next = { ...prev };
                          delete next[hook.publicId];
                          return next;
                        })
                      }
                    >
                      I've stored it
                    </Button>
                  </div>
                ) : (
                  <p className="font-mono text-[12px] text-kr8-fg-muted">
                    {hook.hasSecret
                      ? `signed · ${hook.secretPreview}`
                      : "unsigned — no signing secret configured"}
                  </p>
                )}
              </li>
            );
          })}
          {webhooks.data?.length === 0 && (
            <p className="text-sm text-kr8-fg-muted">No webhooks yet.</p>
          )}
        </ul>
      </div>
    </SettingsLayout>
  );
}
