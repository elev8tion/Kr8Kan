import Link from "next/link";
import { useRouter } from "next/router";
import clsx from "clsx";
import {
  HiMagnifyingGlass,
  HiOutlineCog6Tooth,
  HiOutlineSparkles,
  HiOutlineViewColumns,
} from "react-icons/hi2";

export interface BottomTabBarProps {
  onOpenSearch: () => void;
  onOpenWorkers: () => void;
}

/**
 * Mobile navigation (<md): Boards · Search · AI Workers · Settings.
 * 44px+ targets, labels kept, safe-area padded above the home indicator.
 */
export function BottomTabBar({ onOpenSearch, onOpenWorkers }: BottomTabBarProps) {
  const router = useRouter();
  const isBoards =
    router.pathname.startsWith("/boards") || router.pathname === "/";
  const isSettings = router.pathname.startsWith("/settings");

  const itemClass = (active: boolean) =>
    clsx(
      "flex min-h-[44px] flex-1 flex-col items-center justify-center gap-0.5 rounded-kr8-sm py-1.5 text-[11px] font-medium",
      active ? "text-kr8-accent" : "text-kr8-fg-muted",
    );

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-kr8-border bg-kr8-bg-elevated/95 pb-safe backdrop-blur md:hidden"
    >
      <div className="flex items-stretch px-2 py-1">
        <Link href="/boards" className={itemClass(isBoards)}>
          <HiOutlineViewColumns className="h-6 w-6" />
          Boards
        </Link>
        <button onClick={onOpenSearch} className={itemClass(false)}>
          <HiMagnifyingGlass className="h-6 w-6" />
          Search
        </button>
        <button onClick={onOpenWorkers} className={itemClass(false)}>
          <HiOutlineSparkles className="h-6 w-6" />
          AI Workers
        </button>
        <Link href="/settings" className={itemClass(isSettings)}>
          <HiOutlineCog6Tooth className="h-6 w-6" />
          Settings
        </Link>
      </div>
    </nav>
  );
}
