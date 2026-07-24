import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import {
  HiOutlineCog6Tooth,
  HiOutlineDocumentText,
  HiOutlineFolder,
} from "react-icons/hi2";

import { Button } from "~/components/Button";
import { Dashboard } from "~/components/Dashboard";
import { Input } from "~/components/Input";
import { Modal } from "~/components/Modal";
import { BoardView } from "~/views/board/BoardView";
import { useToast } from "~/providers/toast";
import { api } from "~/utils/api";
import { miniMarkdown, relativeTime } from "~/utils/format";

export default function BoardPage() {
  const router = useRouter();
  const boardPublicId =
    typeof router.query.boardPublicId === "string"
      ? router.query.boardPublicId
      : null;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

  const board = api.board.byPublicId.useQuery(
    { boardPublicId: boardPublicId ?? "" },
    { enabled: Boolean(boardPublicId) },
  );

  return (
    <Dashboard
      title={board.data?.name ?? "Board"}
      padded={false}
      actions={
        <>
          <button
            onClick={() => setNotesOpen(true)}
            aria-label="Board notes"
            className="flex h-9 w-9 items-center justify-center rounded-kr8-sm text-kr8-fg-muted hover:bg-kr8-bg-muted hover:text-kr8-fg"
          >
            <HiOutlineDocumentText className="h-5 w-5" />
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            aria-label="Board settings"
            className="flex h-9 w-9 items-center justify-center rounded-kr8-sm text-kr8-fg-muted hover:bg-kr8-bg-muted hover:text-kr8-fg"
          >
            <HiOutlineCog6Tooth className="h-5 w-5" />
          </button>
        </>
      }
    >
      {boardPublicId && <BoardView boardPublicId={boardPublicId} />}
      {boardPublicId && (
        <BoardNotesModal
          open={notesOpen}
          onClose={() => setNotesOpen(false)}
          boardPublicId={boardPublicId}
        />
      )}
      {boardPublicId && (
        <BoardSettingsModal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          boardPublicId={boardPublicId}
          name={board.data?.name ?? ""}
          agentPath={board.data?.agentPath ?? ""}
          agentVerifyCommand={board.data?.agentVerifyCommand ?? ""}
          visibility={board.data?.visibility ?? "private"}
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
  agentVerifyCommand: initialVerifyCommand,
  visibility: initialVisibility,
}: {
  open: boolean;
  onClose: () => void;
  boardPublicId: string;
  name: string;
  agentPath: string;
  agentVerifyCommand: string;
  visibility: "private" | "public";
}) {
  const router = useRouter();
  const { toast } = useToast();
  const utils = api.useUtils();
  const [name, setName] = useState(initialName);
  const [agentPath, setAgentPath] = useState(initialAgentPath);
  const [verifyCommand, setVerifyCommand] = useState(initialVerifyCommand);
  const [visibility, setVisibility] = useState(initialVisibility);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (open) {
      setName(initialName);
      setAgentPath(initialAgentPath);
      setVerifyCommand(initialVerifyCommand);
      setVisibility(initialVisibility);
    }
  }, [open, initialName, initialAgentPath, initialVerifyCommand, initialVisibility]);

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
              visibility,
              agentPath: agentPath.trim() || null,
              agentVerifyCommand: verifyCommand.trim() || null,
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
            <label className="block text-[13px]">
              <span className="mb-1 block text-kr8-fg-muted">Visibility</span>
              <select
                className="min-h-[44px] w-full rounded-kr8-sm border border-kr8-border bg-kr8-bg px-2 text-sm"
                value={visibility}
                onChange={(e) =>
                  setVisibility(e.target.value as "private" | "public")
                }
              >
                <option value="private">Private — members only</option>
                <option value="public">Public — anyone with the link (read-only)</option>
              </select>
            </label>
            {visibility === "public" && (
              <div className="mt-1.5 flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate font-mono text-[12px] text-kr8-fg-muted">
                  {typeof window !== "undefined"
                    ? `${window.location.origin}/p/${boardPublicId}`
                    : `/p/${boardPublicId}`}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    void navigator.clipboard.writeText(
                      `${window.location.origin}/p/${boardPublicId}`,
                    );
                    toast("Public link copied", "success");
                  }}
                >
                  Copy link
                </Button>
              </div>
            )}
            {visibility === "public" && (
              <p className="mt-1 text-[12px] text-kr8-fg-muted">
                Anyone with the link can view — read-only, no comments or
                members exposed.
              </p>
            )}
          </div>
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
          {agentPath && (
            <Input
              label="Verify command (optional)"
              placeholder="pnpm test"
              value={verifyCommand}
              onChange={(e) => setVerifyCommand(e.target.value)}
              hint="Runs inside the project folder after each dev-task; the job gets a pass/fail badge. Failure never overwrites the agent's result."
            />
          )}
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

/** One markdown notes doc per board — agent digests + human notes land here. */
function BoardNotesModal({
  open,
  onClose,
  boardPublicId,
}: {
  open: boolean;
  onClose: () => void;
  boardPublicId: string;
}) {
  const { toast } = useToast();
  const utils = api.useUtils();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const note = api.board.getNote.useQuery(
    { boardPublicId },
    { enabled: open },
  );
  const save = api.board.updateNote.useMutation({
    onSuccess: () => {
      toast("Notes saved", "success");
      setEditing(false);
      void utils.board.getNote.invalidate({ boardPublicId });
    },
    onError: (err) => toast(err.message, "error"),
  });

  useEffect(() => {
    if (!open) setEditing(false);
  }, [open]);

  const data = note.data as
    | {
        content: string;
        updatedAt: string | Date;
        author?: { name?: string } | null;
        agent?: { displayName: string; avatar: string } | null;
      }
    | null
    | undefined;

  return (
    <Modal open={open} onClose={onClose} title="Board notes" size="lg">
      <div className="space-y-3">
        {data && (
          <p className="text-[12px] text-kr8-fg-muted">
            Last updated by{" "}
            {data.agent
              ? `${data.agent.avatar} ${data.agent.displayName} (agent)`
              : (data.author?.name ?? "unknown")}{" "}
            · {relativeTime(data.updatedAt)}
          </p>
        )}
        {editing ? (
          <>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={14}
              className="w-full rounded-kr8-sm border border-kr8-border bg-kr8-bg-elevated p-3 font-mono text-[13px] outline-none focus:border-kr8-accent"
              placeholder="Markdown notes for this board…"
            />
            <div className="flex gap-2">
              <Button
                loading={save.isPending}
                onClick={() => save.mutate({ boardPublicId, content: draft })}
              >
                Save
              </Button>
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <>
            {data?.content ? (
              <div
                className="prose prose-sm max-h-[55dvh] max-w-none overflow-y-auto rounded-kr8-md border border-kr8-border bg-kr8-bg-elevated p-4 dark:prose-invert"
                dangerouslySetInnerHTML={{ __html: miniMarkdown(data.content) }}
              />
            ) : (
              <p className="rounded-kr8-md border border-dashed border-kr8-border p-6 text-center text-sm text-kr8-fg-muted">
                No notes yet. Agents can write here via the "Post to board
                notes" workflow step — or start typing.
              </p>
            )}
            <Button
              variant="secondary"
              onClick={() => {
                setDraft(data?.content ?? "");
                setEditing(true);
              }}
            >
              Edit notes
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}
