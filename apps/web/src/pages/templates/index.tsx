import { useState } from "react";
import { useRouter } from "next/router";
import { HiOutlineSquares2X2 } from "react-icons/hi2";

import { Button } from "~/components/Button";
import { Dashboard } from "~/components/Dashboard";
import { useToast } from "~/providers/toast";
import { useWorkspace } from "~/providers/workspace";
import { api } from "~/utils/api";

const TEMPLATES = [
  {
    name: "Kanban (classic)",
    description: "To do · Doing · Done — the default three-column flow.",
    lists: ["To do", "Doing", "Done"],
  },
  {
    name: "Weekly sprint",
    description: "Backlog · This week · In progress · Review · Shipped.",
    lists: ["Backlog", "This week", "In progress", "Review", "Shipped"],
  },
  {
    name: "Bug triage",
    description: "Inbox · Confirmed · Fixing · Verifying · Closed.",
    lists: ["Inbox", "Confirmed", "Fixing", "Verifying", "Closed"],
  },
  {
    name: "Content pipeline",
    description: "Ideas · Drafting · Editing · Scheduled · Published.",
    lists: ["Ideas", "Drafting", "Editing", "Scheduled", "Published"],
  },
];

export default function TemplatesPage() {
  const router = useRouter();
  const { activeWorkspace } = useWorkspace();
  const { toast } = useToast();
  const utils = api.useUtils();
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const createBoard = api.board.create.useMutation({
    onSuccess: (board: { publicId: string }) =>
      void router.push(`/boards/${board.publicId}`),
    onError: (err) => toast(err.message, "error"),
  });
  const cardTemplates = api.cardTemplate.list.useQuery(
    { workspacePublicId: activeWorkspace?.publicId ?? "" },
    { enabled: Boolean(activeWorkspace) },
  );
  const deleteTemplate = api.cardTemplate.delete.useMutation({
    onSuccess: () => {
      toast("Template deleted", "success");
      setConfirmingDelete(null);
      void utils.cardTemplate.list.invalidate();
    },
    onError: (err) => toast(err.message, "error"),
  });

  return (
    <Dashboard title="Templates">
      <div className="mx-auto grid w-full max-w-4xl grid-cols-1 gap-4 sm:grid-cols-2">
        {TEMPLATES.map((template) => (
          <div
            key={template.name}
            className="flex flex-col rounded-kr8-md border border-kr8-border bg-kr8-bg-elevated p-4 shadow-kr8-sm"
          >
            <div className="flex items-center gap-2">
              <HiOutlineSquares2X2 className="h-5 w-5 text-kr8-accent" />
              <h2 className="text-[16px] font-semibold">{template.name}</h2>
            </div>
            <p className="mt-1 flex-1 text-sm text-kr8-fg-muted">
              {template.description}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {template.lists.map((list) => (
                <span
                  key={list}
                  className="rounded-full bg-kr8-bg-muted px-2 py-0.5 text-[11px] text-kr8-fg-muted"
                >
                  {list}
                </span>
              ))}
            </div>
            <Button
              className="mt-4"
              variant="secondary"
              loading={createBoard.isPending}
              onClick={() =>
                activeWorkspace &&
                createBoard.mutate({
                  workspacePublicId: activeWorkspace.publicId,
                  name: template.name,
                  defaultLists: template.lists,
                })
              }
            >
              Use template
            </Button>
          </div>
        ))}
      </div>

      {/* Card templates */}
      <div className="mx-auto mt-8 w-full max-w-4xl">
        <h2 className="mb-2 text-[16px] font-semibold">Card templates</h2>
        <ul className="space-y-2">
          {((cardTemplates.data ?? []) as {
            publicId: string;
            name: string;
            title: string;
            checklist: string[];
            labels: string[];
            authorName: string | null;
          }[]).map((t) => (
            <li
              key={t.publicId}
              className="flex flex-wrap items-center gap-2 rounded-kr8-md border border-kr8-border bg-kr8-bg-elevated px-3 py-2.5"
            >
              <span className="text-sm font-medium">{t.name}</span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-kr8-fg-muted">
                {t.title}
              </span>
              {t.checklist.length > 0 && (
                <span className="rounded-full bg-kr8-bg-muted px-2 py-0.5 text-[11px] text-kr8-fg-muted">
                  {t.checklist.length} checklist items
                </span>
              )}
              {t.labels.length > 0 && (
                <span className="rounded-full bg-kr8-bg-muted px-2 py-0.5 text-[11px] text-kr8-fg-muted">
                  {t.labels.join(", ")}
                </span>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="text-kr8-danger"
                loading={deleteTemplate.isPending && confirmingDelete === t.publicId}
                onClick={() => {
                  if (confirmingDelete === t.publicId) {
                    deleteTemplate.mutate({ templatePublicId: t.publicId });
                  } else {
                    setConfirmingDelete(t.publicId);
                  }
                }}
              >
                {confirmingDelete === t.publicId ? "Confirm?" : "Delete"}
              </Button>
            </li>
          ))}
          {cardTemplates.data?.length === 0 && (
            <p className="text-sm text-kr8-fg-muted">
              No card templates yet — open any card and use "Save as template".
              Templates then appear in every list's card composer.
            </p>
          )}
        </ul>
      </div>
    </Dashboard>
  );
}
