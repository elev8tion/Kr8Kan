import type { ButtonHTMLAttributes, ReactNode } from "react";
import { forwardRef } from "react";
import clsx from "clsx";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  fullWidth?: boolean;
  iconLeft?: ReactNode;
}

const variants: Record<Variant, string> = {
  primary:
    "bg-kr8-accent text-kr8-accent-fg hover:opacity-90 shadow-kr8-glow font-semibold",
  secondary:
    "bg-kr8-surface text-kr8-fg border border-kr8-border-strong hover:bg-kr8-surface-hover",
  ghost: "text-kr8-fg-muted hover:text-kr8-fg hover:bg-kr8-bg-muted",
  danger: "bg-kr8-danger text-white hover:opacity-90 font-semibold",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] rounded-kr8-sm",
  md: "h-10 px-4 text-sm rounded-kr8-sm",
  lg: "h-11 px-5 text-[15px] rounded-kr8-md",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "primary",
      size = "md",
      loading,
      fullWidth,
      iconLeft,
      className,
      children,
      disabled,
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        disabled={disabled ?? loading}
        className={clsx(
          "ease-kr8 inline-flex min-h-[44px] items-center justify-center gap-2 transition-colors duration-300 disabled:cursor-not-allowed disabled:opacity-50 md:min-h-0",
          variants[variant],
          sizes[size],
          fullWidth && "w-full",
          className,
        )}
        {...rest}
      >
        {loading ? (
          <span
            aria-hidden
            className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
        ) : (
          iconLeft
        )}
        {children}
      </button>
    );
  },
);
