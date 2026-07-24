import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { HiOutlineCog6Tooth, HiOutlineFolder } from "react-icons/hi2";

import { Button } from "~/components/Button";
import { Dashboard } from "~/components/Dashboard";
import { Input } from "~/components/Input";
import { Modal } from "~/components/Modal";
import { BoardView } from "~/views/board/BoardView";
import { useToast } from "~/providers/toast";
import { api } from "~/utils/api";

export default function BoardPage() {
  const router = useRouter();
  const boardPublicId =
    typeof router.query.boardPublicId === "string"
      ? router.query.boardPublicId
      : null;
  const [settingsOpen, setSettingsOpen] = useState(false);

  const board = api.board.byPublicId.useQuery(
    { boardPublicId: boardPublicId ?? "" },
    { enabled: Boolean(boardPublicId) },
  );

  return (
    <Dashboard
      title={board.data?.name ?? "Board"}
      padded={false}
      actions={
        <button
          onClick={() => setSettingsOpen(true)}
          aria-label="Board settings"
          className="flex h-9 w-9 items-center justify-center rounded-kr8-sm text-kr8-fg-muted hover:bg-kr8-bg-muted hover:text-kr8-fg"
        >
          <HiOutlineCog6Tooth className="h-5 w-5" />
        </button>
      }
    >
      {boardPublicId && <BoardView boardPublicId={boardPublicId} />}
      {boardPublicId && (
        <BoardSettingsModal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          boardPublicId={boardPublicId}
          name={board.data?.name ?? ""}
          agentPath={board.data?.agentPath ?? ""}
        />
      )}
    </Dashboard>
  );
}

function BoardSettingsModal({
  open,
  onClose,
  boardPublicId,
  name: initialName,
  agentPath: initialAgentPath,
}: {
  open: boolean;
  onClose: () => void;
  boardPublicId: string;
  name: string;
  agentPath: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const utils = api.useUtils();
  const [name, setName] = useState(initialName);
  const [agentPath, setAgentPath] = useState(initialAgentPath);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (open) {
      setName(initialName);
      setAgentPath(initialAgentPath);
    }
  }, [open, initialName, initialAgentPath]);

  const workers = api.agent.listWorkers.useQuery(undefined, { enabled: open });

  const update = api.board.update.useMutation({
    onSuccess: () => {
      void utils.board.byPublicId.invalidate({ boardPublicId });
      void utils.board.list.invalidate();
      toast("Board updated", "success");
      onClose();
    },
    onError: (err) => toast(err.message, "error"),
  });
  const deleteBoard = api.board.delete.useMutation({
    onSuccess: () => {
      void utils.board.list.invalidate();
      void router.push("/boards");
    },
    onError: (err) => toast(err.message, "error"),
  });

  const roots = (workers.data?.projectRoots ?? []) as string[];
  const toolsOn = Boolean(workers.data?.toolsAllowed);

  return (
    <>
      <Modal open={open} onClose={onClose} title="Board settings">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate({
              boardPublicId,
              name: name.trim() || undefined,
              agentPath: agentPath.trim() || null,
            });
          }}
          className="space-y-4"
        >
          <Input
            label="Board name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div>
            <Input
              label="Project folder (dev agents)"
              placeholder="/Users/kc/code/my-project"
              value={agentPath}
              onChange={(e) => setAgentPath(e.target.value)}
              hint={
                toolsOn
                  ? roots.length > 0
                    ? `Dev agents run pi with tools inside this folder. Allowed under: ${roots.join(", ")}`
                    : "Set KR8KAN_PI_PROJECT_ROOTS in .env to allow folder runs."
                  : "Tool runs are off — set KR8KAN_PI_ALLOW_TOOLS=true in .env."
              }
            />
            {agentPath && (
              <p className="mt-1 flex items-center gap-1.5 text-[12px] text-kr8-fg-muted">
                <HiOutlineFolder className="h-3.5 w-3.5" />
                Cards on this board can run the “Dev agent” worker in this folder.
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button type="submit" loading={update.isPending}>
              Save
            </Button>
            <div className="flex-1" />
            <Button
              type="button"
              variant="ghost"
              className="text-kr8-danger"
              onClick={() => setConfirmingDelete(true)}
            >
              Delete board
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        title="Delete this board?"
        size="sm"
      >
        <p className="text-sm text-kr8-fg-muted">
          “{initialName}” and all of its lists and cards will be removed.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmingDelete(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={deleteBoard.isPending}
            onClick={() => deleteBoard.mutate({ boardPublicId })}
          >
            Delete board
          </Button>
        </div>
      </Modal>
    </>
  );
}
