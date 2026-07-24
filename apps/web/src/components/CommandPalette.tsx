import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import {
  Combobox,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
  Dialog,
  DialogPanel,
} from "@headlessui/react";
import { useTheme } from "next-themes";
import {
  HiMagnifyingGlass,
  HiOutlineChatBubbleLeft,
  HiOutlineCog6Tooth,
  HiOutlineMoon,
  HiOutlinePlus,
  HiOutlineSparkles,
  HiOutlineViewColumns,
} from "react-icons/hi2";

import { useWorkspace } from "~/providers/workspace";
import { api } from "~/utils/api";

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: typeof HiOutlineViewColumns;
  run: () => void;
}

/** ⌘K / Ctrl+K palette: jump to boards, quick actions. Also the mobile
 * "Search" tab target. */
export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { activeWorkspace } = useWorkspace();
  const { resolvedTheme, setTheme } = useTheme();
  const [query, setQuery] = useState("");

  const boards = api.board.list.useQuery(
    { workspacePublicId: activeWorkspace?.publicId ?? "" },
    { enabled: open && Boolean(activeWorkspace) },
  );
  // Full-text search over cards, comments, and agent results (FTS).
  const search = api.search.query.useQuery(
    { workspacePublicId: activeWorkspace?.publicId ?? "", q: query },
    { enabled: open && Boolean(activeWorkspace) && query.trim().length > 2 },
  );

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const boardCommands: Command[] =
      boards.data?.map((b: { publicId: string; name: string }) => ({
        id: `board-${b.publicId}`,
        label: b.name,
        hint: "Board",
        icon: HiOutlineViewColumns,
        run: () => void router.push(`/boards/${b.publicId}`),
      })) ?? [];
    const actions: Command[] = [
      {
        id: "new-board",
        label: "Create new board",
        hint: "Action",
        icon: HiOutlinePlus,
        run: () => void router.push("/boards?new=1"),
      },
      {
        id: "theme",
        label: `Switch to ${resolvedTheme === "dark" ? "light" : "dark"} theme`,
        hint: "Action",
        icon: HiOutlineMoon,
        run: () => setTheme(resolvedTheme === "dark" ? "light" : "dark"),
      },
      {
        id: "settings",
        label: "Open settings",
        hint: "Action",
        icon: HiOutlineCog6Tooth,
        run: () => void router.push("/settings"),
      },
    ];
    const searchCommands: Command[] = (
      (search.data as
        | {
            kind: string;
            cardPublicId?: string;
            boardPublicId?: string;
            title: string;
            snippet: string;
          }[]
        | undefined) ?? []
    ).map((hit, i) => ({
      id: `search-${i}`,
      label: hit.title,
      hint:
        hit.kind === "card"
          ? "Card"
          : hit.kind === "comment"
            ? "Comment"
            : "Agent result",
      icon:
        hit.kind === "agent_result"
          ? HiOutlineSparkles
          : hit.kind === "comment"
            ? HiOutlineChatBubbleLeft
            : HiOutlineViewColumns,
      run: () => {
        if (hit.boardPublicId && hit.cardPublicId) {
          void router.push(`/boards/${hit.boardPublicId}?card=${hit.cardPublicId}`);
        } else if (hit.boardPublicId) {
          void router.push(`/boards/${hit.boardPublicId}`);
        } else {
          void router.push("/settings/agents");
        }
      },
    }));
    const all = [...boardCommands, ...actions];
    const filtered = !query
      ? all
      : all.filter((c) => c.label.toLowerCase().includes(query.toLowerCase()));
    return [...filtered, ...searchCommands];
  }, [boards.data, search.data, query, resolvedTheme, router, setTheme]);

  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/45" aria-hidden />
      <div className="fixed inset-0 flex items-start justify-center p-4 pt-[12vh]">
        <DialogPanel className="w-full max-w-lg animate-kr8-in overflow-hidden rounded-kr8-lg border border-kr8-border bg-kr8-bg-elevated shadow-kr8-md">
          <Combobox
            onChange={(command: Command | null) => {
              if (command) {
                command.run();
                onClose();
              }
            }}
          >
            <div className="flex items-center gap-2 border-b border-kr8-border px-4">
              <HiMagnifyingGlass className="h-5 w-5 text-kr8-fg-muted" />
              <ComboboxInput
                autoFocus
                placeholder="Search boards, run actions…"
                className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-kr8-fg-muted"
                onChange={(e) => setQuery(e.target.value)}
              />
              <kbd className="hidden rounded border border-kr8-border px-1.5 py-0.5 font-mono text-[11px] text-kr8-fg-muted md:block">
                esc
              </kbd>
            </div>
            <ComboboxOptions static className="max-h-72 overflow-y-auto p-2">
              {commands.length === 0 && (
                <p className="px-3 py-6 text-center text-sm text-kr8-fg-muted">
                  Nothing matches “{query}”
                </p>
              )}
              {commands.map((command) => (
                <ComboboxOption
                  key={command.id}
                  value={command}
                  className="group flex min-h-[44px] cursor-pointer items-center gap-3 rounded-kr8-sm px-3 text-sm text-kr8-fg-muted data-[focus]:bg-kr8-accent-wash data-[focus]:text-kr8-fg"
                >
                  <command.icon className="h-4 w-4 text-kr8-fg-muted" />
                  <span className="flex-1 truncate">{command.label}</span>
                  {command.hint && (
                    <span className="kr8-eyebrow">{command.hint}</span>
                  )}
                </ComboboxOption>
              ))}
            </ComboboxOptions>
          </Combobox>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
