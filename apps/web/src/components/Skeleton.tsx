import clsx from "clsx";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={clsx("animate-pulse rounded-kr8-sm bg-kr8-bg-muted", className)}
    />
  );
}

/** Board-shaped loading state: list column placeholders, not a spinner. */
export function BoardSkeleton() {
  return (
    <div className="flex gap-4 overflow-hidden p-4">
      {[3, 2, 4].map((cards, i) => (
        <div
          key={i}
          className="w-[280px] shrink-0 rounded-kr8-md border border-kr8-border bg-kr8-bg-elevated p-3"
        >
          <Skeleton className="mb-3 h-5 w-2/3" />
          <div className="space-y-2">
            {Array.from({ length: cards }).map((_, j) => (
              <Skeleton key={j} className="h-16 w-full" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ListRowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  );
}
