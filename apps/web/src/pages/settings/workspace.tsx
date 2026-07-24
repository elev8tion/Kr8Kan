import { useEffect, useState } from "react";
import { useRouter } from "next/router";

import { Button } from "~/components/Button";
import { Input, Textarea } from "~/components/Input";
import { Modal } from "~/components/Modal";
import { SettingsLayout } from "~/components/SettingsLayout";
import { useToast } from "~/providers/toast";
import { useWorkspace } from "~/providers/workspace";
import { api } from "~/utils/api";

export default function WorkspaceSettingsPage() {
  const router = useRouter();
  const { activeWorkspace } = useWorkspace();
  const { toast } = useToast();
  const utils = api.useUtils();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const workspace = api.workspace.byPublicId.useQuery(
    { workspacePublicId: activeWorkspace?.publicId ?? "" },
    { enabled: Boolean(activeWorkspace) },
  );

  useEffect(() => {
    if (workspace.data) {
      setName(workspace.data.name);
      setDescription(workspace.data.description ?? "");
    }
  }, [workspace.data]);

  const update = api.workspace.update.useMutation({
    onSuccess: () => {
      void utils.user.me.invalidate();
      void utils.workspace.byPublicId.invalidate();
      toast("Workspace updated", "success");
    },
    onError: (err) => toast(err.message, "error"),
  });

  const deleteWorkspace = api.workspace.delete.useMutation({
    onSuccess: async () => {
      await utils.user.me.invalidate();
      void router.push("/boards");
    },
    onError: (err) => toast(err.message, "error"),
  });

  const isAdmin = activeWorkspace?.role === "admin";

  return (
    <SettingsLayout title="Workspace">
      <div className="max-w-md space-y-8">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (activeWorkspace && name.trim()) {
              update.mutate({
                workspacePublicId: activeWorkspace.publicId,
                name: name.trim(),
                description: description || null,
              });
            }
          }}
          className="space-y-4"
        >
          <Input
            label="Workspace name"
            value={name}
            disabled={!isAdmin}
            onChange={(e) => setName(e.target.value)}
          />
          <Textarea
            label="Description"
            value={description}
            disabled={!isAdmin}
            onChange={(e) => setDescription(e.target.value)}
          />
          <p className="text-[12px] text-kr8-fg-muted">
            Plan: <strong>selfhost</strong> — every feature unlocked, nothing to
            upgrade, nothing to bill.
          </p>
          {isAdmin && (
            <Button type="submit" loading={update.isPending}>
              Save
            </Button>
          )}
        </form>

        {isAdmin && (
          <div className="rounded-kr8-md border border-kr8-danger/40 p-4">
            <h2 className="text-[15px] font-semibold text-kr8-danger">
              Danger zone
            </h2>
            <p className="mt-1 text-sm text-kr8-fg-muted">
              Deleting the workspace soft-deletes every board, list, and card in it.
            </p>
            <Button
              className="mt-3"
              variant="danger"
              onClick={() => setConfirmingDelete(true)}
            >
              Delete workspace
            </Button>
          </div>
        )}
      </div>

      <Modal
        open={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        title="Delete this workspace?"
        size="sm"
      >
        <p className="text-sm text-kr8-fg-muted">
          “{workspace.data?.name}” and all of its boards will be removed for
          every member. This cannot be undone from the UI.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmingDelete(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={deleteWorkspace.isPending}
            onClick={() =>
              activeWorkspace &&
              deleteWorkspace.mutate({
                workspacePublicId: activeWorkspace.publicId,
              })
            }
          >
            Delete workspace
          </Button>
        </div>
      </Modal>
    </SettingsLayout>
  );
}
