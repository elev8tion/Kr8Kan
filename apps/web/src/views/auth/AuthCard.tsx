import type { ReactNode } from "react";

/** Shared auth chrome: centered card on desktop, full-bleed on mobile,
 * soft CSS-only gradient background. */
export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="kr8-auth-gradient flex min-h-dvh flex-col items-center justify-center px-4 py-10 pb-safe pt-safe">
      <div className="mb-8 flex items-center gap-2.5">
        <span className="flex h-10 w-10 items-center justify-center rounded-kr8-md bg-kr8-accent text-lg font-bold text-kr8-accent-fg shadow-kr8-sm">
          K8
        </span>
        <span className="text-xl font-bold tracking-tight">Kr8Kan</span>
      </div>
      <div className="w-full max-w-md animate-kr8-in rounded-kr8-lg border border-kr8-border bg-kr8-bg-elevated p-6 shadow-kr8-md sm:p-8">
        <h1 className="text-[22px] font-semibold leading-tight">{title}</h1>
        {subtitle && (
          <p className="mt-1 text-sm text-kr8-fg-muted">{subtitle}</p>
        )}
        <div className="mt-6">{children}</div>
      </div>
      {footer && (
        <p className="mt-6 text-sm text-kr8-fg-muted">{footer}</p>
      )}
      <p className="mt-8 text-[12px] text-kr8-fg-muted">
        Self-hosted · your data stays on your machine
      </p>
    </main>
  );
}
