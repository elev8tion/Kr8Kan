export function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-kr8-bg-muted"
      >
        <div
          className="h-full rounded-full bg-kr8-accent transition-[width] duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[12px] tabular-nums text-kr8-fg-muted">
        {value}/{max}
      </span>
    </div>
  );
}
