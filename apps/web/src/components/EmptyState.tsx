import type { ReactNode } from "react";

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}

export function EmptyState({ title, description, action, icon }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 text-kr8-fg-muted">
        {icon ?? (
          <svg
            width="72"
            height="56"
            viewBox="0 0 72 56"
            fill="none"
            aria-hidden
            className="opacity-70"
          >
            <rect x="2" y="6" width="20" height="44" rx="4" stroke="currentColor" strokeWidth="2" />
            <rect x="26" y="6" width="20" height="32" rx="4" stroke="currentColor" strokeWidth="2" />
            <rect x="50" y="6" width="20" height="38" rx="4" stroke="currentColor" strokeWidth="2" />
            <rect x="6" y="12" width="12" height="6" rx="2" fill="currentColor" opacity="0.5" />
            <rect x="30" y="12" width="12" height="6" rx="2" fill="currentColor" opacity="0.5" />
            <rect x="54" y="12" width="12" height="6" rx="2" fill="currentColor" opacity="0.5" />
            <rect x="6" y="22" width="12" height="6" rx="2" fill="currentColor" opacity="0.3" />
          </svg>
        )}
      </div>
      <h2 className="text-[20px] font-semibold leading-tight">{title}</h2>
      {description && (
        <p className="mt-1.5 max-w-sm text-sm text-kr8-fg-muted">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
