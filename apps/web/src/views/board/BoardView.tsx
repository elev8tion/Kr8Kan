import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";
import type { DropResult } from "@hello-pangea/dnd";
import { DragDropContext, Draggable, Droppable } from "@hello-pangea/dnd";
import clsx from "clsx";
import {
  HiEllipsisHorizontal,
  HiOutlineChatBubbleLeft,
  HiOutlineSparkles,
  HiPlus,
} from "react-icons/hi2";

import { Badge } from "~/components/Badge";
import { AvatarStack } from "~/components/Avatar";
import { Button } from "~/components/Button";
import { BoardSkeleton } from "~/components/Skeleton";
import { Dropdown } from "~/components/Dropdown";
import { EmptyState } from "~/components/EmptyState";
import { FAB } from "~/components/FAB";
import { WorkerRunner } from "~/components/WorkerRunner";
import { useIsMobile } from "~/hooks/useIsMobile";
import { useToast } from "~/providers/toast";
import { api } from "~/utils/api";
import { formatDate, isOverdue } from "~/utils/format";

import { CardDetail } from "./CardDetail";

/* Board payload comes from an openapi-annotated procedure (output: any);
 * these local shapes give the view its structure. */
interface BoardCard {
  publicId: string;
  title: string;
  dueDate: string | Date | null;
  labels: { label: { publicId: string; name: string; colourCode: string } }[];
  members: {
    member: { publicId: string; user: { name: string; image?: string | null } };
  }[];
  comments: { id: number }[];
  checklists: { items: { id: number; completed: boolean }[] }[];
}

interface BoardList {
  publicId: string;
  name: string;
  cards: BoardCard[];
}

export function BoardView({ boardPublicId }: { boardPublicId: string }) {
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const utils = api.useUtils();
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  const [workersOpen, setWorkersOpen] = useState(false);
  // Deep link (?card=…) from search results opens the card directly.
  const router = useRouter();
  useEffect(() => {
    const fromQuery = router.query.card;
    if (typeof fromQuery === "string" && fromQuery.length === 12) {
      setSelectedCard(fromQuery);
    }
  }, [router.query.card]);
  const [composerList, setComposerList] = useState<string | null>(null);
  const [addingList, setAddingList] = useState(false);

  const board = api.board.byPublicId.useQuery({ boardPublicId });

  const invalidate = useCallback(
    () => void utils.board.byPublicId.invalidate({ boardPublicId }),
    [utils, boardPublicId],
  );

  const moveCard = api.card.move.useMutation({
    onError: (err) => {
      toast(`Move failed — ${err.message}`, "error");
      invalidate();
    },
    onSettled: invalidate,
  });
  const reorderList = api.list.reorder.useMutation({
    onError: () => invalidate(),
    onSettled: invalidate,
  });
  const createList = api.list.create.useMutation({
    onSuccess: invalidate,
    onError: (err) => toast(err.message, "error"),
  });
  const renameList = api.list.update.useMutation({ onSettled: invalidate });
  const deleteList = api.list.delete.useMutation({ onSettled: invalidate });
  const createCard = api.card.create.useMutation({
    onSuccess: invalidate,
    onError: (err) => toast(err.message, "error"),
  });

  const onDragEnd = useCallback(
    (result: DropResult) => {
      const { destination, source, draggableId, type } = result;
      if (!destination) return;
      if (
        destination.droppableId === source.droppableId &&
        destination.index === source.index
      ) {
        return;
      }

      if (type === "LIST") {
        reorderList.mutate({
          listPublicId: draggableId,
          toIndex: destination.index,
        });
        return;
      }

      // Optimistic card move: reshuffle the cached board before the server answers.
      utils.board.byPublicId.setData({ boardPublicId }, (prev: unknown) => {
        if (!prev) return prev;
        const data = structuredClone(prev) as { lists: BoardList[] };
        const from = data.lists.find((l) => l.publicId === source.droppableId);
        const to = data.lists.find(
          (l) => l.publicId === destination.droppableId,
        );
        if (!from || !to) return prev;
        const [card] = from.cards.splice(source.index, 1);
        if (!card) return prev;
        to.cards.splice(destination.index, 0, card);
        return data;
      });

      moveCard.mutate({
        cardPublicId: draggableId,
        toListPublicId: destination.droppableId,
        position: destination.index,
      });
    },
    [utils, boardPublicId, moveCard, reorderList],
  );

  if (board.isLoading) return <BoardSkeleton />;
  if (!board.data) {
    return (
      <EmptyState
        title="Board not found"
        description="It may have been deleted, or you may not have access."
      />
    );
  }

  const lists = (board.data.lists ?? []) as BoardList[];

  return (
    <div className="kr8-pattern flex min-h-0 flex-1 flex-col">
      <DragDropContext onDragEnd={onDragEnd}>
        <Droppable droppableId="board" type="LIST" direction="horizontal">
          {(dropProvided) => (
            <div
              ref={dropProvided.innerRef}
              {...dropProvided.droppableProps}
              className={clsx(
                "flex min-h-0 flex-1 items-start gap-3 overflow-x-auto p-3 md:gap-4 md:p-4",
                isMobile && "snap-x-mandatory scrollbar-none",
              )}
            >
              {lists.map((list, index) => (
                <Draggable
                  key={list.publicId}
                  draggableId={list.publicId}
                  index={index}
                  isDragDisabled={isMobile}
                >
                  {(dragProvided) => (
                    <div
                      ref={dragProvided.innerRef}
                      {...dragProvided.draggableProps}
                      className={clsx(
                        "flex max-h-full w-[85vw] shrink-0 flex-col rounded-kr8-md border border-kr8-border bg-kr8-bg-elevated/95 shadow-kr8-sm",
                        "md:w-[288px]",
                        isMobile && "snap-center-child",
                      )}
                    >
                      <div
                        {...dragProvided.dragHandleProps}
                        className="sticky top-0 z-10 flex items-center gap-2 rounded-t-kr8-md border-b border-kr8-border bg-kr8-bg-elevated/95 px-3 py-2.5"
                      >
                        <InlineListName
                          name={list.name}
                          onRename={(name) =>
                            renameList.mutate({
                              listPublicId: list.publicId,
                              name,
                            })
                          }
                        />
                        <Badge>{list.cards.length}</Badge>
                        <div className="flex-1" />
                        <Dropdown
                          buttonLabel={`List actions for ${list.name}`}
                          button={<HiEllipsisHorizontal className="h-5 w-5" />}
                          items={[
                            {
                              label: "Add card",
                              onClick: () => setComposerList(list.publicId),
                            },
                            {
                              label: "AI: summarize board",
                              onClick: () => setWorkersOpen(true),
                            },
                            {
                              label: "Delete list",
                              danger: true,
                              onClick: () =>
                                deleteList.mutate({
                                  listPublicId: list.publicId,
                                }),
                            },
                          ]}
                        />
                      </div>

                      <Droppable droppableId={list.publicId} type="CARD">
                        {(cardsProvided, snapshot) => (
                          <div
                            ref={cardsProvided.innerRef}
                            {...cardsProvided.droppableProps}
                            className={clsx(
                              "min-h-[40px] flex-1 space-y-2 overflow-y-auto p-2",
                              snapshot.isDraggingOver && "bg-kr8-accent/5",
                            )}
                          >
                            {list.cards.map((card, cardIndex) => (
                              <Draggable
                                key={card.publicId}
                                draggableId={card.publicId}
                                index={cardIndex}
                              >
                                {(cardProvided, cardSnapshot) => (
                                  <div
                                    ref={cardProvided.innerRef}
                                    {...cardProvided.draggableProps}
                                    {...cardProvided.dragHandleProps}
                                    onClick={() =>
                                      setSelectedCard(card.publicId)
                                    }
                                    className={clsx(
                                      "group cursor-pointer rounded-kr8-sm border border-kr8-border bg-kr8-bg-elevated p-3 transition-shadow",
                                      cardSnapshot.isDragging
                                        ? "rotate-1 opacity-90 shadow-kr8-md ring-1 ring-kr8-accent"
                                        : "hover:border-kr8-border-strong hover:shadow-kr8-sm",
                                    )}
                                  >
                                    <CardFace card={card} />
                                  </div>
                                )}
                              </Draggable>
                            ))}
                            {cardsProvided.placeholder}

                            {composerList === list.publicId ? (
                              <CardComposer
                                pending={createCard.isPending}
                                onSubmit={(title) => {
                                  createCard.mutate({
                                    listPublicId: list.publicId,
                                    title,
                                  });
                                  setComposerList(null);
                                }}
                                onCancel={() => setComposerList(null)}
                              />
                            ) : (
                              <button
                                onClick={() => setComposerList(list.publicId)}
                                className="flex min-h-[44px] w-full items-center gap-1.5 rounded-kr8-sm px-2 py-2 text-[13px] text-kr8-fg-muted hover:bg-kr8-bg-muted hover:text-kr8-fg md:min-h-0"
                              >
                                <HiPlus className="h-4 w-4" /> Add card
                              </button>
                            )}
                          </div>
                        )}
                      </Droppable>
                    </div>
                  )}
                </Draggable>
              ))}
              {dropProvided.placeholder}

              <div className="w-[85vw] shrink-0 md:w-[288px]">
                {addingList ? (
                  <CardComposer
                    placeholder="List name"
                    pending={createList.isPending}
                    onSubmit={(name) => {
                      createList.mutate({ boardPublicId, name });
                      setAddingList(false);
                    }}
                    onCancel={() => setAddingList(false)}
                  />
                ) : (
                  <button
                    onClick={() => setAddingList(true)}
                    className="flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-kr8-md border border-dashed border-kr8-accent/25 px-3 py-3 text-sm text-kr8-fg-muted hover:border-kr8-accent/60 hover:text-kr8-fg"
                  >
                    <HiPlus className="h-4 w-4" /> Add list
                  </button>
                )}
              </div>
            </div>
          )}
        </Droppable>
      </DragDropContext>

      <FAB
        label="New card"
        onClick={() => {
          if (lists.length === 0) setAddingList(true);
          else setComposerList(lists[0]!.publicId);
        }}
      />

      {selectedCard && (
        <CardDetail
          cardPublicId={selectedCard}
          boardPublicId={boardPublicId}
          lists={lists.map((l) => ({ publicId: l.publicId, name: l.name }))}
          workspacePublicId={board.data.workspace?.publicId as string}
          onClose={() => {
            setSelectedCard(null);
            invalidate();
          }}
        />
      )}

      <WorkerRunner
        open={workersOpen}
        onClose={() => setWorkersOpen(false)}
        boardPublicId={boardPublicId}
      />
    </div>
  );
}

function CardFace({ card }: { card: BoardCard }) {
  const labels = card.labels ?? [];
  const checklistItems = (card.checklists ?? []).flatMap((c) => c.items);
  const done = checklistItems.filter((i) => i.completed).length;
  return (
    <>
      {labels.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {labels.slice(0, 3).map(({ label }) => (
            <span
              key={label.publicId}
              className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium"
              style={{
                backgroundColor: `${label.colourCode}22`,
                color: label.colourCode,
              }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: label.colourCode }}
              />
              {label.name}
            </span>
          ))}
          {labels.length > 3 && (
            <Badge className="text-[10px]">+{labels.length - 3}</Badge>
          )}
        </div>
      )}
      <p className="line-clamp-3 text-sm font-medium leading-snug">
        {card.title}
      </p>
      <div className="mt-2 flex items-center gap-2 empty:hidden">
        {card.dueDate && (
          <Badge tone={isOverdue(card.dueDate) ? "danger" : "neutral"}>
            {formatDate(card.dueDate)}
          </Badge>
        )}
        {checklistItems.length > 0 && (
          <span className="text-[11px] tabular-nums text-kr8-fg-muted">
            ☑ {done}/{checklistItems.length}
          </span>
        )}
        {(card.comments?.length ?? 0) > 0 && (
          <span className="flex items-center gap-0.5 text-[11px] text-kr8-fg-muted">
            <HiOutlineChatBubbleLeft className="h-3.5 w-3.5" />
            {card.comments.length}
          </span>
        )}
        <div className="flex-1" />
        <AvatarStack
          people={(card.members ?? []).map((m) => ({
            name: m.member.user.name,
            image: m.member.user.image,
          }))}
        />
      </div>
    </>
  );
}

function CardComposer({
  onSubmit,
  onCancel,
  pending,
  placeholder = "Card title",
}: {
  onSubmit: (title: string) => void;
  onCancel: () => void;
  pending?: boolean;
  placeholder?: string;
}) {
  const [title, setTitle] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim()) onSubmit(title.trim());
      }}
      className="rounded-kr8-sm border border-kr8-accent bg-kr8-bg-elevated p-2"
    >
      <textarea
        autoFocus
        rows={2}
        value={title}
        placeholder={placeholder}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (title.trim()) onSubmit(title.trim());
          }
          if (e.key === "Escape") onCancel();
        }}
        className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-kr8-fg-muted"
      />
      <div className="mt-1 flex gap-2">
        <Button type="submit" size="sm" loading={pending}>
          Add
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function InlineListName({
  name,
  onRename,
}: {
  name: string;
  onRename: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  if (!editing) {
    return (
      <button
        onClick={() => {
          setValue(name);
          setEditing(true);
        }}
        className="truncate text-sm font-semibold hover:text-kr8-accent"
        title="Rename list"
      >
        {name}
      </button>
    );
  }
  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        setEditing(false);
        if (value.trim() && value !== name) onRename(value.trim());
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setEditing(false);
      }}
      className="w-32 rounded border border-kr8-accent bg-transparent px-1 text-sm font-semibold outline-none"
    />
  );
}
