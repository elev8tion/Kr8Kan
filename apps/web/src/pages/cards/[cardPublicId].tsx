import { useRouter } from "next/router";

import { Dashboard } from "~/components/Dashboard";
import { CardDetail } from "~/views/board/CardDetail";
import { api } from "~/utils/api";

/** Deep-link card page: renders the card detail against its board. */
export default function CardPage() {
  const router = useRouter();
  const cardPublicId =
    typeof router.query.cardPublicId === "string"
      ? router.query.cardPublicId
      : null;

  const card = api.card.byPublicId.useQuery(
    { cardPublicId: cardPublicId ?? "" },
    { enabled: Boolean(cardPublicId) },
  );

  const board = card.data?.list?.board;

  return (
    <Dashboard title={card.data?.title ?? "Card"}>
      {cardPublicId && board && (
        <div className="mx-auto max-w-2xl">
          <CardDetail
            cardPublicId={cardPublicId}
            boardPublicId={board.publicId}
            workspacePublicId={board.workspace?.publicId}
            lists={[]}
            onClose={() => void router.push(`/boards/${board.publicId}`)}
          />
        </div>
      )}
    </Dashboard>
  );
}
