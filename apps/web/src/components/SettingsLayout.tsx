import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import clsx from "clsx";
import { HiChevronLeft, HiChevronRight } from "react-icons/hi2";

import { Dashboard } from "./Dashboard";

export const SETTINGS_NAV = [
  { href: "/settings/account", label: "Account", blurb: "Name, email, sign-out" },
  { href: "/settings/workspace", label: "Workspace", blurb: "Name, description, danger zone" },
  { href: "/settings/api", label: "API keys", blurb: "REST access tokens" },
  { href: "/settings/agents", label: "AI workers", blurb: "Pi workers, health, job history" },
  { href: "/settings/workflows", label: "Workflows", blurb: "Trigger → worker → gate → apply" },
  { href: "/settings/audit", label: "Audit log", blurb: "Hash-chained history, verify" },
  { href: "/settings/trash", label: "Trash", blurb: "Restore deleted boards, lists, cards" },
  { href: "/settings/webhooks", label: "Webhooks", blurb: "Card events → your URLs" },
  { href: "/settings/integrations", label: "Integrations", blurb: "MCP, webhooks, workers" },
  { href: "/settings/permissions", label: "Permissions", blurb: "Role capability matrix" },
];

/**
 * Settings: desktop gets a secondary left subnav; mobile navigates from
 * the /settings hub into full-width subpages (back link on top).
 */
export function SettingsLayout({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const router = useRouter();
  return (
    <Dashboard title="Settings">
      <div className="mx-auto flex w-full max-w-4xl gap-8">
        <nav aria-label="Settings" className="hidden w-48 shrink-0 md:block">
          <ul className="space-y-1">
            {SETTINGS_NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={clsx(
                    "block rounded-kr8-sm px-3 py-2 text-sm font-medium",
                    router.pathname === item.href
                      ? "bg-kr8-accent/12 text-kr8-accent"
                      : "text-kr8-fg-muted hover:bg-kr8-bg-muted hover:text-kr8-fg",
                  )}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 flex-1">
          <Link
            href="/settings"
            className="mb-3 flex items-center gap-1 text-[13px] text-kr8-fg-muted hover:text-kr8-fg md:hidden"
          >
            <HiChevronLeft className="h-4 w-4" /> Settings
          </Link>
          <h1 className="mb-5 text-[20px] font-semibold">{title}</h1>
          {children}
        </div>
      </div>
    </Dashboard>
  );
}

/** Mobile settings hub — list of subpages. Desktop redirects to account. */
export function SettingsHub() {
  return (
    <Dashboard title="Settings">
      <div className="mx-auto w-full max-w-4xl">
        <ul className="space-y-2 md:hidden">
          {SETTINGS_NAV.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="flex min-h-[56px] items-center gap-3 rounded-kr8-md border border-kr8-border bg-kr8-bg-elevated px-4 py-3 shadow-kr8-sm"
              >
                <div className="flex-1">
                  <p className="text-sm font-semibold">{item.label}</p>
                  <p className="text-[12px] text-kr8-fg-muted">{item.blurb}</p>
                </div>
                <HiChevronRight className="h-4 w-4 text-kr8-fg-muted" />
              </Link>
            </li>
          ))}
        </ul>
        <div className="hidden md:block">
          <DesktopHubRedirect />
        </div>
      </div>
    </Dashboard>
  );
}

function DesktopHubRedirect() {
  const router = useRouter();
  if (typeof window !== "undefined" && router.pathname === "/settings") {
    void router.replace("/settings/account");
  }
  return null;
}
