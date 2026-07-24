import Head from "next/head";
import { useRouter } from "next/router";

import { ProgressBar } from "~/components/ProgressBar";
import { api } from "~/utils/api";
import { formatDate, isOverdue } from "~/utils/format";

/**
 * Public read-only board (`visibility: public`). Standalone layout — no
 * Dashboard chrome, no auth. The API payload is server-redacted: no
 * members, comments, or agent config ever reach this page.
 */
export default function PublicBoardPage() {
  const router = useRouter();
  const boardPublicId =
    typeof router.query.boardPublicId === "string"
      ? router.query.boardPublicId
      : "";

  const board = api.board.publicView.useQuery(
    { boardPublicId },
    { enabled: boardPublicId.length === 12, retry: false },
  );

  if (board.isLoading) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-kr8-bg text-kr8-fg">
        <p className="text-sm text-kr8-fg-muted">Loading board…</p>
      </main>
    );
  }
  if (board.isError || !board.data) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-2 bg-kr8-bg text-kr8-fg">
        <h1 className="text-lg font-semibold">Board not available</h1>
        <p className="text-sm text-kr8-fg-muted">
          This board is private or does not exist.
        </p>
      </main>
    );
  }

  const data = board.data as {
    name: string;
    workspaceName: string;
    lists: {
      publicId: string;
      name: string;
      cards: {
        publicId: string;
        title: string;
        description: string | null;
        dueDate: string | null;
        labels: { name: string; colourCode: string }[];
        checklistDone: number;
        checklistTotal: number;
      }[];
    }[];
  };

  return (
    <>
      <Head>
        <title>{`${data.name} · Kr8Kan`}</title>
        <meta name="robots" content="noindex" />
      </Head>
      <main className="flex min-h-dvh flex-col bg-kr8-bg text-kr8-fg">
        <header className="border-b border-kr8-border px-5 py-4">
          <h1 className="text-[18px] font-semibold">{data.name}</h1>
          <p className="text-[12px] text-kr8-fg-muted">
            {data.workspaceName} · read-only view
          </p>
        </header>

        <div className="flex flex-1 gap-4 overflow-x-auto p-5">
          {data.lists.map((list) => (
            <section
              key={list.publicId}
              className="flex w-72 shrink-0 flex-col rounded-kr8-lg border border-kr8-border bg-kr8-bg-elevated"
            >
              <h2 className="flex items-baseline gap-2 px-3 py-2.5 text-[13px] font-semibold">
                {list.name}
                <span className="text-[11px] font-normal text-kr8-fg-muted">
                  {list.cards.length}
                </span>
              </h2>
              <div className="flex flex-col gap-2 overflow-y-auto px-2 pb-2">
                {list.cards.map((card) => (
                  <article
                    key={card.publicId}
                    className="rounded-kr8-md border border-kr8-border bg-kr8-bg p-3"
                  >
                    {card.labels.length > 0 && (
                      <div className="mb-1.5 flex flex-wrap gap-1">
                        {card.labels.map((label) => (
                          <span
                            key={label.name}
                            className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
                            style={{ backgroundColor: label.colourCode }}
                          >
                            {label.name}
                          </span>
                        ))}
                      </div>
                    )}
                    <h3 className="text-sm font-medium">{card.title}</h3>
                    {card.description && (
                      <p className="mt-1 line-clamp-3 text-[12px] text-kr8-fg-muted">
                        {card.description}
                      </p>
                    )}
                    <div className="mt-2 flex items-center gap-3 text-[11px] text-kr8-fg-muted">
                      {card.dueDate && (
                        <span
                          className={
                            isOverdue(card.dueDate) ? "text-kr8-danger" : undefined
                          }
                        >
                          due {formatDate(card.dueDate)}
                        </span>
                      )}
                      {card.checklistTotal > 0 && (
                        <span className="flex flex-1 items-center gap-1.5">
                          <span className="min-w-fit">
                            {card.checklistDone}/{card.checklistTotal}
                          </span>
                          <ProgressBar
                            value={card.checklistDone}
                            max={card.checklistTotal}
                          />
                        </span>
                      )}
                    </div>
                  </article>
                ))}
                {list.cards.length === 0 && (
                  <p className="px-1 pb-1 text-[12px] text-kr8-fg-muted">
                    No cards.
                  </p>
                )}
              </div>
            </section>
          ))}
        </div>

        <footer className="border-t border-kr8-border px-5 py-3 text-center text-[11px] text-kr8-fg-muted">
          Powered by Kr8Kan — self-hosted kanban
        </footer>
      </main>
    </>
  );
}
