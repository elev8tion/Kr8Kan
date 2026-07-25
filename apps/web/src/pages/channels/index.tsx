import { useState } from "react";
import Link from "next/link";
import { HiOutlineChatBubbleLeftRight, HiOutlineHashtag } from "react-icons/hi2";

import { Button } from "~/components/Button";
import { Dashboard } from "~/components/Dashboard";
import { EmptyState } from "~/components/EmptyState";
import { Input } from "~/components/Input";
import { Modal } from "~/components/Modal";
import { useToast } from "~/providers/toast";
import { useWorkspace } from "~/providers/workspace";
import { api } from "~/utils/api";

export default function ChannelsPage() {
  const { activeWorkspace } = useWorkspace();
  const { toast } = useToast();
  const utils = api.useUtils();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");

  const channels = api.channel.list.useQuery(
    { workspacePublicId: activeWorkspace?.publicId ?? "" },
    { enabled: Boolean(activeWorkspace) },
  );
  const createChannel = api.channel.create.useMutation({
    onSuccess: () => {
      setCreating(false);
      setName("");
      setTopic("");
      void utils.channel.list.invalidate();
    },
    onError: (err) => toast(err.message, "error"),
  });

  interface ChannelItem {
    publicId: string;
    name: string;
    topic: string | null;
    board: { publicId: string; name: string } | null;
    archivedAt: string | Date | null;
  }
  const rows = (channels.data ?? []) as ChannelItem[];
  const live = rows.filter((c) => !c.archivedAt);
  const archived = rows.filter((c) => c.archivedAt);

  return (
    <Dashboard title="Channels">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-kr8-fg-muted">
          Workspace conversations — humans and agents, one thread model.
        </p>
        <Button onClick={() => setCreating(true)}>New channel</Button>
      </div>

      {channels.data && live.length === 0 && archived.length === 0 ? (
        <EmptyState
          icon={<HiOutlineChatBubbleLeftRight className="h-10 w-10" />}
          title="No channels yet"
          description="Create the first channel to give this workspace a conversation surface."
          action={<Button onClick={() => setCreating(true)}>New channel</Button>}
        />
      ) : (
        <div className="space-y-1">
          {live.map((channel) => (
            <Link
              key={channel.publicId}
              href={`/channels/${channel.publicId}`}
              className="flex items-center gap-3 rounded-kr8-sm border border-kr8-border bg-kr8-bg-elevated px-4 py-3 hover:border-kr8-accent"
            >
              <HiOutlineHashtag className="h-5 w-5 shrink-0 text-kr8-fg-muted" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{channel.name}</div>
                {channel.topic && (
                  <div className="truncate text-[12px] text-kr8-fg-muted">
                    {channel.topic}
                  </div>
                )}
              </div>
              {channel.board && (
                <span className="shrink-0 text-[11px] text-kr8-fg-muted">
                  📋 {channel.board.name}
                </span>
              )}
            </Link>
          ))}
        </div>
      )}

      {archived.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-kr8-fg-muted">
            Archived
          </h2>
          <div className="space-y-1">
            {archived.map((channel) => (
              <Link
                key={channel.publicId}
                href={`/channels/${channel.publicId}`}
                className="flex items-center gap-3 rounded-kr8-sm border border-kr8-border px-4 py-3 opacity-60 hover:opacity-100"
              >
                <HiOutlineHashtag className="h-5 w-5 shrink-0 text-kr8-fg-muted" />
                <span className="truncate text-sm">{channel.name}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="New channel">
        <div className="space-y-3">
          <Input
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="release-flow"
            maxLength={80}
          />
          <Input
            label="Topic (optional)"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="What is this channel for?"
            maxLength={250}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button
              loading={createChannel.isPending}
              disabled={!name.trim() || !activeWorkspace}
              onClick={() =>
                createChannel.mutate({
                  workspacePublicId: activeWorkspace!.publicId,
                  name: name.trim(),
                  topic: topic.trim() || undefined,
                })
              }
            >
              Create
            </Button>
          </div>
        </div>
      </Modal>
    </Dashboard>
  );
}
