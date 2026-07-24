import type { ButtonHTMLAttributes } from "react";
import clsx from "clsx";
import { HiPlus } from "react-icons/hi2";

/**
 * Floating action button — mobile only, sits above the bottom tab bar,
 * clear of the iOS home indicator.
 */
export function FAB({
  label,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      className={clsx(
        "fixed bottom-[calc(76px+env(safe-area-inset-bottom))] right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-kr8-accent text-kr8-accent-fg shadow-kr8-md transition-transform active:scale-95 md:hidden",
        className,
      )}
      {...rest}
    >
      <HiPlus className="h-6 w-6" />
    </button>
  );
}
