import Link from "next/link";
import { useRouter } from "next/router";
import clsx from "clsx";
import {
  HiChevronDoubleLeft,
  HiChevronDoubleRight,
  HiOutlineCog6Tooth,
  HiOutlineSparkles,
  HiOutlineSquares2X2,
  HiOutlineUsers,
  HiOutlineViewColumns,
} from "react-icons/hi2";

import { useLocalStorage } from "~/hooks/useLocalStorage";
import { useWorkspace } from "~/providers/workspace";

const NAV = [
  { href: "/boards", label: "Boards", icon: HiOutlineViewColumns },
  { href: "/members", label: "Members", icon: HiOutlineUsers },
  { href: "/templates", label: "Templates", icon: HiOutlineSquares2X2 },
  { href: "/settings/agents", label: "AI Workers", icon: HiOutlineSparkles },
  { href: "/settings", label: "Settings", icon: HiOutlineCog6Tooth },
];

/** Desktop side nav (md+): 240px expanded ↔ 64px icon rail, persisted. */
export function SideNavigation() {
  const router = useRouter();
  const { activeWorkspace } = useWorkspace();
  const [collapsed, setCollapsed] = useLocalStorage("kr8kan.nav.collapsed", false);

  return (
    <nav
      aria-label="Workspace"
      className={clsx(
        "sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-kr8-border bg-kr8-bg-elevated transition-[width] duration-200 md:flex",
        collapsed ? "w-16" : "w-60",
      )}
    >
      <div className="flex items-center gap-2 px-4 py-4">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-kr8-sm bg-kr8-accent font-bold text-kr8-accent-fg">
          K8
        </span>
        {!collapsed && (
          <div className="min-w-0">
            <div className="truncate text-sm font-bold">Kr8Kan</div>
            <div className="truncate text-[12px] text-kr8-fg-muted">
              {activeWorkspace?.name ?? "…"}
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 space-y-1 px-2 py-2">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/settings"
              ? router.pathname === "/settings" ||
                (router.pathname.startsWith("/settings") &&
                  !router.pathname.startsWith("/settings/agents"))
              : router.pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              title={collapsed ? label : undefined}
              className={clsx(
                "flex items-center gap-3 rounded-kr8-sm px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-kr8-accent/12 text-kr8-accent"
                  : "text-kr8-fg-muted hover:bg-kr8-bg-muted hover:text-kr8-fg",
                collapsed && "justify-center px-0",
              )}
            >
              <Icon className="h-5 w-5 shrink-0" />
              {!collapsed && label}
            </Link>
          );
        })}
      </div>

      <button
        onClick={() => setCollapsed(!collapsed)}
        aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
        className="m-2 flex items-center justify-center gap-2 rounded-kr8-sm px-3 py-2 text-[12px] text-kr8-fg-muted hover:bg-kr8-bg-muted"
      >
        {collapsed ? (
          <HiChevronDoubleRight className="h-4 w-4" />
        ) : (
          <>
            <HiChevronDoubleLeft className="h-4 w-4" /> Collapse
          </>
        )}
      </button>
    </nav>
  );
}
