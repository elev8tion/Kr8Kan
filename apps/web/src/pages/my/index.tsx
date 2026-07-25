import Link from "next/link";
import {
  HiOutlineChatBubbleLeftRight,
  HiOutlineCheckCircle,
  HiOutlineClock,
  HiOutlineHandRaised,
} from "react-icons/hi2";

import { Badge } from "~/components/Badge";
import { Dashboard } from "~/components/Dashboard";
import { EmptyState } from "~/components/EmptyState";
import { useWorkspace } from "~/providers/workspace";
import { api } from "~/utils/api";
import { isOverdue, relativeTime } from "~/utils/format";

/**
 * /my — the caller's attention surface: gates they can approve, work due
 * soon, and everything assigned to them, across the workspace's boards.
 */
export default function MyWorkPage() {
  const { activeWorkspace } = useWorkspace();
  const overview = api.my.overview.useQuery(
    { workspacePublicId: activeWorkspace?.publicId ?? "" },
    { enabled: Boolean(activeWorkspace), refetchInterval: 30_000 },
  );

  const cardHref = (boardPublicId: string | null | undefined, cardPublicId: string | null | undefined, commentPublicId?: string | null) => {
    if (!boardPublicId || !cardPublicId) return "/boards";
    const base = `/boards/${boardPublicId}?card=${cardPublicId}`;
    return commentPublicId ? `${base}&comment=${commentPublicId}` : base;
  };

  const data = overview.data;
  const byBoard = new Map<string, { boardName: string; boardPublicId: string; cards: NonNullable<typeof data>["assignedCards"] }>();
  for (const card of data?.assignedCards ?? []) {
    const entry = byBoard.get(card.boardPublicId) ?? {
      boardName: card.boardName,
      boardPublicId: card.boardPublicId,
      cards: [],
    };
    entry.cards.push(card);
    byBoard.set(card.boardPublicId, entry);
  }

  return (
    <Dashboard title="My work">
      <div className="max-w-3xl space-y-8">
        {/* Pending approvals */}
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-[15px] font-semibold">
            <HiOutlineHandRaised className="h-4 w-4 text-kr8-accent" />
            Pending approvals
            {(data?.pendingGates.length ?? 0) > 0 && (
              <Badge tone="accent">{data?.pendingGates.length}</Badge>
            )}
          </h2>
          <ul className="space-y-2">
            {(data?.pendingGates ?? []).map((gate) => (
              <li key={gate.runPublicId}>
                <Link
                  href={cardHref(gate.boardPublicId, gate.cardPublicId, gate.gateCommentPublicId)}
                  className="flex min-h-[48px] flex-wrap items-center gap-2 rounded-kr8-md border border-kr8-accent/40 bg-kr8-accent/5 px-3 py-2.5 hover:border-kr8-accent"
                >
                  <span className="text-sm font-medium">{gate.workflowName}</span>
                  <span className="text-[12px] text-kr8-fg-muted">
                    react 👍 to approve
                  </span>
                  <span className="ml-auto text-[12px] text-kr8-fg-muted">
                    {gate.gateExpiresAt
                      ? `expires ${relativeTime(gate.gateExpiresAt)}`
                      : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {data?.pendingGates.length === 0 && (
            <p className="text-sm text-kr8-fg-muted">Nothing waiting on you.</p>
          )}
        </section>

        {/* Due soon */}
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-[15px] font-semibold">
            <HiOutlineClock className="h-4 w-4 text-kr8-warning" />
            Due soon
          </h2>
          <ul className="space-y-2">
            {(data?.dueSoon ?? []).map((card) => (
              <li key={card.publicId}>
                <Link
                  href={cardHref(card.boardPublicId, card.publicId)}
                  className="flex min-h-[48px] flex-wrap items-center gap-2 rounded-kr8-md border border-kr8-border bg-kr8-bg-elevated px-3 py-2.5 hover:border-kr8-accent"
                >
                  <span className="text-sm font-medium">{card.title}</span>
                  <span className="text-[12px] text-kr8-fg-muted">
                    {card.boardName} · {card.listName}
                  </span>
                  <span className="ml-auto">
                    <Badge tone={isOverdue(card.dueDate) ? "danger" : "warning"}>
                      {isOverdue(card.dueDate)
                        ? `overdue · ${relativeTime(card.dueDate!)}`
                        : `due ${relativeTime(card.dueDate!)}`}
                    </Badge>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {data?.dueSoon.length === 0 && (
            <p className="text-sm text-kr8-fg-muted">Nothing due this week.</p>
          )}
        </section>

        {/* Channel activity */}
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-[15px] font-semibold">
            <HiOutlineChatBubbleLeftRight className="h-4 w-4 text-kr8-accent" />
            Channel activity
          </h2>
          <ul className="space-y-2">
            {(data?.channelActivity ?? []).map((m) => {
              const params = new URLSearchParams({ message: m.messagePublicId });
              if (m.threadRootPublicId) params.set("thread", m.threadRootPublicId);
              return (
                <li key={m.messagePublicId}>
                  <Link
                    href={`/channels/${m.channelPublicId}?${params.toString()}`}
                    className="flex min-h-[48px] flex-wrap items-center gap-2 rounded-kr8-md border border-kr8-border bg-kr8-bg-elevated px-3 py-2.5 hover:border-kr8-accent"
                  >
                    <span className="text-sm font-medium">#{m.channelName}</span>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-kr8-fg-muted">
                      {m.authorName}: {m.snippet}
                    </span>
                    <span className="ml-auto shrink-0 text-[12px] text-kr8-fg-muted">
                      {relativeTime(m.at)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {data?.channelActivity?.length === 0 && (
            <p className="text-sm text-kr8-fg-muted">
              Mentions and thread replies land here.
            </p>
          )}
        </section>

        {/* Assigned to me */}
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-[15px] font-semibold">
            <HiOutlineCheckCircle className="h-4 w-4 text-kr8-success" />
            Assigned to me
          </h2>
          {[...byBoard.values()].map((group) => (
            <div key={group.boardPublicId} className="mb-4">
              <h3 className="mb-1.5 text-[13px] font-semibold text-kr8-fg-muted">
                {group.boardName}
              </h3>
              <ul className="space-y-1.5">
                {group.cards.map((card) => (
                  <li key={card.publicId}>
                    <Link
                      href={cardHref(card.boardPublicId, card.publicId)}
                      className="flex min-h-[44px] items-center gap-2 rounded-kr8-sm border border-kr8-border bg-kr8-bg-elevated px-3 py-2 hover:border-kr8-accent"
                    >
                      <span className="truncate text-sm">{card.title}</span>
                      <span className="ml-auto shrink-0 text-[12px] text-kr8-fg-muted">
                        {card.listName}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {byBoard.size === 0 && !overview.isLoading && (
            <EmptyState
              title="Nothing assigned"
              description="Cards you're added to as a member show up here."
            />
          )}
        </section>
      </div>
    </Dashboard>
  );
}
