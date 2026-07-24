import { HiArrowUturnLeft, HiOutlineTrash } from "react-icons/hi2";

import { Button } from "~/components/Button";
import { SettingsLayout } from "~/components/SettingsLayout";
import { useToast } from "~/providers/toast";
import { useWorkspace } from "~/providers/workspace";
import { api } from "~/utils/api";
import { relativeTime } from "~/utils/format";

/**
 * Workspace trash: soft-deleted boards/lists/cards with restore. Restoring
 * a card also restores its deleted list/board so it becomes visible again.
 */
export default function TrashSettingsPage() {
  const { activeWorkspace } = useWorkspace();
  const { toast } = useToast();
  const utils = api.useUtils();

  const trash = api.trash.list.useQuery(
    { workspacePublicId: activeWorkspace?.publicId ?? "" },
    { enabled: Boolean(activeWorkspace) },
  );
  const restore = api.trash.restore.useMutation({
    onSuccess: () => {
      toast("Restored", "success");
      void utils.trash.list.invalidate();
      void utils.board.list.invalidate();
      void utils.board.byPublicId.invalidate();
    },
    onError: (err) => toast(err.message, "error"),
  });

  const empty =
    trash.data &&
    trash.data.boards.length === 0 &&
    trash.data.lists.length === 0 &&
    trash.data.cards.length === 0;

  const row = (
    key: string,
    title: string,
    location: string | null,
    deletedAt: string | Date | null,
    onRestore: () => void,
  ) => (
    <li
      key={key}
      className="flex min-h-[48px] items-center gap-3 rounded-kr8-sm border border-kr8-border bg-kr8-bg-elevated px-3 py-2"
    >
      <HiOutlineTrash className="h-4 w-4 shrink-0 text-kr8-fg-muted" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{title}</p>
        {location && (
          <p className="truncate text-[12px] text-kr8-fg-muted">{location}</p>
        )}
      </div>
      {deletedAt && (
        <span className="text-[12px] text-kr8-fg-muted">
          deleted {relativeTime(deletedAt)}
        </span>
      )}
      <Button
        size="sm"
        variant="secondary"
        loading={restore.isPending}
        iconLeft={<HiArrowUturnLeft className="h-4 w-4" />}
        onClick={onRestore}
      >
        Restore
      </Button>
    </li>
  );

  return (
    <SettingsLayout title="Trash">
      <div className="max-w-2xl space-y-6">
        {empty && (
          <p className="text-sm text-kr8-fg-muted">
            Trash is empty. Deleted items are restorable for 30 days.
          </p>
        )}

        {(trash.data?.boards.length ?? 0) > 0 && (
          <section>
            <h2 className="mb-2 text-[15px] font-semibold">Boards</h2>
            <ul className="space-y-1.5">
              {trash.data!.boards.map((b) =>
                row(b.publicId, b.name, null, b.deletedAt, () =>
                  restore.mutate({ entityType: "board", publicId: b.publicId }),
                ),
              )}
            </ul>
          </section>
        )}

        {(trash.data?.lists.length ?? 0) > 0 && (
          <section>
            <h2 className="mb-2 text-[15px] font-semibold">Lists</h2>
            <ul className="space-y-1.5">
              {trash.data!.lists.map((l) =>
                row(l.publicId, l.name, `in ${l.boardName}`, l.deletedAt, () =>
                  restore.mutate({ entityType: "list", publicId: l.publicId }),
                ),
              )}
            </ul>
          </section>
        )}

        {(trash.data?.cards.length ?? 0) > 0 && (
          <section>
            <h2 className="mb-2 text-[15px] font-semibold">Cards</h2>
            <ul className="space-y-1.5">
              {trash.data!.cards.map((c) =>
                row(
                  c.publicId,
                  c.title,
                  `${c.listName} · ${c.boardName}`,
                  c.deletedAt,
                  () =>
                    restore.mutate({ entityType: "card", publicId: c.publicId }),
                ),
              )}
            </ul>
          </section>
        )}

        <p className="text-[12px] text-kr8-fg-muted">
          Restoring a card also restores its list and board if they were
          deleted. Older items are hidden here but not purged.
        </p>
      </div>
    </SettingsLayout>
  );
}
