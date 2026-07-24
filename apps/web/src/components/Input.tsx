import type {
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";
import { forwardRef } from "react";
import clsx from "clsx";

const fieldClasses =
  "w-full rounded-kr8-sm border border-kr8-border bg-kr8-bg-elevated px-3 py-2 text-sm text-kr8-fg placeholder:text-kr8-fg-muted focus:border-kr8-accent focus:outline-none focus:ring-2 focus:ring-kr8-accent/30 disabled:opacity-50";

export interface FieldWrapperProps {
  label?: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}

export function FieldWrapper({ label, error, hint, children }: FieldWrapperProps) {
  return (
    <label className="block space-y-1.5">
      {label && (
        <span className="block text-[13px] font-medium text-kr8-fg">
          {label}
        </span>
      )}
      {children}
      {error ? (
        <span className="block text-[12px] text-kr8-danger">{error}</span>
      ) : hint ? (
        <span className="block text-[12px] text-kr8-fg-muted">{hint}</span>
      ) : null}
    </label>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, className, ...rest },
  ref,
) {
  return (
    <FieldWrapper label={label} error={error} hint={hint}>
      <input
        ref={ref}
        className={clsx(fieldClasses, error && "border-kr8-danger", className)}
        {...rest}
      />
    </FieldWrapper>
  );
});

export interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ label, error, hint, className, ...rest }, ref) {
    return (
      <FieldWrapper label={label} error={error} hint={hint}>
        <textarea
          ref={ref}
          className={clsx(
            fieldClasses,
            "min-h-[88px] resize-y",
            error && "border-kr8-danger",
            className,
          )}
          {...rest}
        />
      </FieldWrapper>
    );
  },
);
