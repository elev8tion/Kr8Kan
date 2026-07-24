import { useState } from "react";
import { HiOutlineClipboard, HiPlus } from "react-icons/hi2";

import { authClient } from "@kr8kan/auth/client";

import { Button } from "~/components/Button";
import { Input } from "~/components/Input";
import { Modal } from "~/components/Modal";
import { SettingsLayout } from "~/components/SettingsLayout";
import { useToast } from "~/providers/toast";
import { relativeTime } from "~/utils/format";

interface ApiKeyRow {
  id: string;
  name?: string | null;
  start?: string | null;
  createdAt: string | Date;
  enabled?: boolean;
}

export default function ApiSettingsPage() {
  const { toast } = useToast();
  const [keys, setKeys] = useState<ApiKeyRow[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApiKeyRow | null>(null);

  const load = async () => {
    const { data } = await authClient.apiKey.list();
    setKeys((data as ApiKeyRow[] | null) ?? []);
  };
  if (keys === null && typeof window !== "undefined") void load();

  const createKey = async () => {
    const { data, error } = await authClient.apiKey.create({
      name: keyName || "kr8kan-api",
    });
    if (error || !data) {
      toast(error?.message ?? "Failed to create key", "error");
      return;
    }
    setFreshKey((data as { key: string }).key);
    setKeyName("");
    void load();
  };

  const deleteKey = async (id: string) => {
    await authClient.apiKey.delete({ keyId: id });
    setDeleteTarget(null);
    void load();
  };

  return (
    <SettingsLayout title="API keys">
      <div className="max-w-2xl space-y-5">
        <p className="text-sm text-kr8-fg-muted">
          Keys authenticate REST calls to{" "}
          <code className="rounded bg-kr8-bg-muted px-1.5 py-0.5 font-mono text-[12px]">
            /api/v1/*
          </code>{" "}
          via <code className="font-mono text-[12px]">Authorization: Bearer</code> or{" "}
          <code className="font-mono text-[12px]">x-api-key</code>. OpenAPI spec:{" "}
          <a
            href="/api/v1/openapi.json"
            className="font-medium text-kr8-accent hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            /api/v1/openapi.json
          </a>
        </p>

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Input
              label="New key name"
              placeholder="ci-bot"
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
            />
          </div>
          <Button onClick={() => void createKey()} iconLeft={<HiPlus className="h-4 w-4" />}>
            Create
          </Button>
        </div>

        {freshKey && (
          <div className="rounded-kr8-md border border-kr8-success/40 bg-kr8-success/10 p-4">
            <p className="text-[13px] font-semibold text-kr8-success">
              Copy this key now — it won't be shown again.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded bg-kr8-bg-elevated px-2 py-1.5 font-mono text-[12px]">
                {freshKey}
              </code>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard.writeText(freshKey);
                  toast("Key copied", "success");
                }}
              >
                <HiOutlineClipboard className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        <ul className="space-y-2">
          {(keys ?? []).map((key) => (
            <li
              key={key.id}
              className="flex items-center gap-3 rounded-kr8-md border border-kr8-border bg-kr8-bg-elevated p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{key.name ?? "unnamed"}</p>
                <p className="font-mono text-[12px] text-kr8-fg-muted">
                  {key.start ?? "••••"}… · created {relativeTime(key.createdAt)}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="text-kr8-danger"
                onClick={() => setDeleteTarget(key)}
              >
                Revoke
              </Button>
            </li>
          ))}
          {keys?.length === 0 && (
            <p className="text-sm text-kr8-fg-muted">No API keys yet.</p>
          )}
        </ul>
      </div>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Revoke API key?"
        size="sm"
      >
        <p className="text-sm text-kr8-fg-muted">
          Anything using <strong>{deleteTarget?.name ?? "this key"}</strong> will
          stop working immediately.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => deleteTarget && void deleteKey(deleteTarget.id)}
          >
            Revoke key
          </Button>
        </div>
      </Modal>
    </SettingsLayout>
  );
}
