import type { ReactNode } from "react";
import clsx from "clsx";

export type BadgeTone = "neutral" | "accent" | "danger" | "warning" | "success";

const tones: Record<BadgeTone, string> = {
  neutral: "bg-kr8-bg-muted text-kr8-fg-muted",
  accent: "bg-kr8-accent/15 text-kr8-accent",
  danger: "bg-kr8-danger/15 text-kr8-danger",
  warning: "bg-kr8-warning/15 text-kr8-warning",
  success: "bg-kr8-success/15 text-kr8-success",
};

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
