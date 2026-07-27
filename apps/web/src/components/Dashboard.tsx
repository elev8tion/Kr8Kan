import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { HiChevronUpDown, HiOutlineSparkles } from "react-icons/hi2";

import { signOutEverywhere } from "~/utils/signOut";

import { BottomTabBar } from "./BottomTabBar";
import { SideNavigation } from "./SideNavigation";
import { CommandPalette } from "./CommandPalette";
import { Dropdown } from "./Dropdown";
import { NotificationBell } from "./NotificationBell";
import { ThemeToggle } from "./ThemeToggle";
import { WorkerRunner } from "./WorkerRunner";
import { Avatar } from "./Avatar";
import { useWorkspace } from "~/providers/workspace";

/**
 * App shell. Desktop: side nav + thin top bar. Mobile: compact top bar,
 * bottom tab bar, content padded clear of both.
 */
export function Dashboard({
  children,
  title,
  actions,
  padded = true,
}: {
  children: ReactNode;
  title?: string;
  actions?: ReactNode;
  padded?: boolean;
}) {
  const router = useRouter();
  const { activeWorkspace, workspaces, setActiveWorkspace, user } =
    useWorkspace();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [workersOpen, setWorkersOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const signOut = () => signOutEverywhere();

  return (
    <div className="flex min-h-dvh bg-kr8-bg">
      <SideNavigation />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-kr8-border bg-kr8-bg/90 px-4 backdrop-blur">
          {workspaces.length > 1 ? (
            <Dropdown
              align="left"
              buttonLabel="Switch workspace"
              button={
                <span className="flex items-center gap-1.5 px-2 text-sm font-semibold">
                  {activeWorkspace?.name ?? "Workspace"}
                  <HiChevronUpDown className="h-4 w-4 text-kr8-fg-muted" />
                </span>
              }
              items={workspaces.map((w) => ({
                label: w.name,
                onClick: () => setActiveWorkspace(w.publicId),
              }))}
            />
          ) : (
            <span className="px-2 text-sm font-semibold">
              {activeWorkspace?.name ?? "Kr8Kan"}
            </span>
          )}
          {title && (
            <>
              <span className="text-kr8-fg-muted">/</span>
              <h1 className="truncate font-display text-[15px] font-semibold tracking-[-0.01em]">
                {title}
              </h1>
            </>
          )}
          <div className="flex-1" />
          {actions}
          <button
            onClick={() => setWorkersOpen(true)}
            className="hidden items-center gap-1.5 rounded-kr8-sm border border-kr8-border px-3 py-1.5 text-[13px] font-medium text-kr8-fg-muted hover:bg-kr8-bg-muted hover:text-kr8-fg md:flex"
          >
            <HiOutlineSparkles className="h-4 w-4 text-kr8-accent" />
            AI worker
          </button>
          <button
            onClick={() => setPaletteOpen(true)}
            aria-label="Command palette"
            className="hidden rounded-kr8-sm border border-kr8-border px-2 py-1.5 font-mono text-[11px] text-kr8-fg-muted hover:bg-kr8-bg-muted md:block"
          >
            ⌘K
          </button>
          <NotificationBell />
          <ThemeToggle />
          {user && (
            <Dropdown
              buttonLabel="Account"
              button={<Avatar name={user.name || user.email} image={user.image} />}
              items={[
                {
                  label: "Account settings",
                  onClick: () => void router.push("/settings/account"),
                },
                { label: "Sign out", onClick: () => void signOut(), danger: true },
              ]}
            />
          )}
        </header>

        <main
          className={
            padded
              ? "kr8-stagger flex-1 px-4 pb-[calc(84px+env(safe-area-inset-bottom))] pt-4 md:px-6 md:pb-8"
              : "flex flex-1 flex-col pb-[calc(68px+env(safe-area-inset-bottom))] md:pb-0"
          }
        >
          {children}
        </main>
      </div>

      <BottomTabBar
        onOpenSearch={() => setPaletteOpen(true)}
        onOpenWorkers={() => setWorkersOpen(true)}
      />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <WorkerRunner open={workersOpen} onClose={() => setWorkersOpen(false)} />
    </div>
  );
}
