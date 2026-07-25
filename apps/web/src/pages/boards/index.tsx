import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { HiOutlineViewColumns, HiPlus } from "react-icons/hi2";

import { Badge } from "~/components/Badge";
import { Button } from "~/components/Button";
import { Dashboard } from "~/components/Dashboard";
import { EmptyState } from "~/components/EmptyState";
import { FAB } from "~/components/FAB";
import { Input } from "~/components/Input";
import { Modal } from "~/components/Modal";
import { Skeleton } from "~/components/Skeleton";
import { useToast } from "~/providers/toast";
import { useWorkspace } from "~/providers/workspace";
import { api } from "~/utils/api";

export default function BoardsPage() {
  const router = useRouter();
  const { activeWorkspace } = useWorkspace();
  const { toast } = useToast();
  const utils = api.useUtils();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [withChannel, setWithChannel] = useState(false);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (router.query.new === "1") setCreating(true);
  }, [router.query.new]);

  const boards = api.board.list.useQuery(
    { workspacePublicId: activeWorkspace?.publicId ?? "" },
    { enabled: Boolean(activeWorkspace) },
  );

  const createBoard = api.board.create.useMutation({
    onSuccess: (board: { publicId: string }) => {
      void utils.board.list.invalidate();
      setCreating(false);
      setName("");
      void router.push(`/boards/${board.publicId}`);
    },
    onError: (err) => toast(err.message, "error"),
  });

  const filtered = (boards.data ?? []).filter(
    (b: { name: string }) =>
      !filter || b.name.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <Dashboard title="Boards">
      <div className="mx-auto w-full max-w-5xl">
        <div className="sticky top-14 z-20 -mx-1 mb-4 flex items-center gap-3 bg-kr8-bg/95 px-1 py-2 backdrop-blur">
          <div className="max-w-xs flex-1">
            <Input
              placeholder="Filter boards…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Filter boards"
            />
          </div>
          <div className="flex-1" />
          <Button
            onClick={() => setCreating(true)}
            iconLeft={<HiPlus className="h-4 w-4" />}
            className="hidden md:inline-flex"
          >
            New board
          </Button>
        </div>

        {boards.isLoading && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-36" />
            ))}
          </div>
        )}

        {boards.data && filtered.length === 0 && (
          <EmptyState
            title={filter ? "No boards match" : "No boards yet"}
            description={
              filter
                ? `Nothing named “${filter}” here.`
                : "Create your first board — lists and cards live inside it."
            }
            action={
              !filter && (
                <Button onClick={() => setCreating(true)} iconLeft={<HiPlus className="h-4 w-4" />}>
                  Create board
                </Button>
              )
            }
          />
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(
            (board: {
              publicId: string;
              name: string;
              visibility: string;
              listCount: number;
              cardCount: number;
            }) => (
              <Link
                key={board.publicId}
                href={`/boards/${board.publicId}`}
                className="group overflow-hidden rounded-kr8-lg border border-kr8-border bg-kr8-surface transition-colors duration-300 ease-kr8 hover:border-kr8-border-strong hover:bg-kr8-surface-hover"
              >
                <div className="p-[18px]">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="line-clamp-2 text-[15px] font-semibold leading-snug">
                      {board.name}
                    </h2>
                    <HiOutlineViewColumns className="h-5 w-5 shrink-0 text-kr8-fg-muted/60" />
                  </div>
                  <div className="mt-4 flex items-end gap-6 border-t border-kr8-border pt-3">
                    <div>
                      <div className="kr8-eyebrow">Lists</div>
                      <div className="font-mono text-[15px] font-semibold">
                        {board.listCount}
                      </div>
                    </div>
                    <div>
                      <div className="kr8-eyebrow">Cards</div>
                      <div className="font-mono text-[15px] font-semibold">
                        {board.cardCount}
                      </div>
                    </div>
                    <div className="flex-1" />
                    {board.visibility === "public" && (
                      <Badge tone="accent">public</Badge>
                    )}
                  </div>
                </div>
              </Link>
            ),
          )}
        </div>
      </div>

      <FAB label="New board" onClick={() => setCreating(true)} />

      <Modal open={creating} onClose={() => setCreating(false)} title="New board">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && activeWorkspace) {
              createBoard.mutate({
                workspacePublicId: activeWorkspace.publicId,
                name: name.trim(),
                withChannel,
              });
            }
          }}
          className="space-y-4"
        >
          <Input
            label="Board name"
            autoFocus
            placeholder="Q3 launch"
            value={name}
            onChange={(e) => setName(e.target.value)}
            hint="Starts with To do / Doing / Done lists — rename anything later."
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={withChannel}
              onChange={(e) => setWithChannel(e.target.checked)}
              className="h-4 w-4 accent-kr8-accent"
            />
            Also create a #channel for this board
          </label>
          <Button type="submit" fullWidth loading={createBoard.isPending}>
            Create board
          </Button>
        </form>
      </Modal>
    </Dashboard>
  );
}
