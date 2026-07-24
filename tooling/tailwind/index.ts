import type { Config } from "tailwindcss";

/**
 * Kr8Kan shared Tailwind preset — maps the `--kr8-*` design tokens
 * (defined in apps/web/src/styles/globals.css) onto semantic utilities:
 *   bg-kr8-bg, bg-kr8-surface, text-kr8-fg-muted, border-kr8-border,
 *   bg-kr8-accent text-kr8-accent-fg, rounded-kr8-md, shadow-kr8-glow, …
 *
 * Triplet tokens (`--kr8-accent: 157 213 34`) go through rgb()/<alpha-value>
 * so Tailwind opacity modifiers (bg-kr8-accent/15) actually work; film
 * tokens with baked-in alpha (surface, border, wash) pass through as-is.
 */
const preset: Omit<Config, "content"> = {
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        kr8: {
          bg: "rgb(var(--kr8-bg) / <alpha-value>)",
          "bg-elevated": "rgb(var(--kr8-bg-elevated) / <alpha-value>)",
          "bg-muted": "var(--kr8-bg-muted)",
          fg: "rgb(var(--kr8-fg) / <alpha-value>)",
          "fg-muted": "rgb(var(--kr8-fg-muted) / <alpha-value>)",
          border: "var(--kr8-border)",
          "border-strong": "var(--kr8-border-strong)",
          surface: "var(--kr8-surface)",
          "surface-hover": "var(--kr8-surface-hover)",
          accent: "rgb(var(--kr8-accent) / <alpha-value>)",
          "accent-fg": "var(--kr8-accent-fg)",
          "accent-wash": "var(--kr8-accent-wash)",
          danger: "rgb(var(--kr8-danger) / <alpha-value>)",
          warning: "rgb(var(--kr8-warning) / <alpha-value>)",
          success: "rgb(var(--kr8-success) / <alpha-value>)",
        },
      },
      borderRadius: {
        "kr8-sm": "var(--kr8-radius-sm)",
        "kr8-md": "var(--kr8-radius-md)",
        "kr8-lg": "var(--kr8-radius-lg)",
      },
      boxShadow: {
        "kr8-sm": "var(--kr8-shadow-sm)",
        "kr8-md": "var(--kr8-shadow-md)",
        "kr8-glow": "var(--kr8-glow)",
      },
      fontFamily: {
        sans: "var(--kr8-font-sans)",
        display: "var(--kr8-font-display)",
        mono: "var(--kr8-font-mono)",
      },
      transitionTimingFunction: {
        kr8: "var(--kr8-ease)",
      },
      spacing: {
        "safe-bottom": "env(safe-area-inset-bottom)",
        "safe-top": "env(safe-area-inset-top)",
      },
      keyframes: {
        "kr8-in": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "kr8-fade-up": {
          from: { opacity: "0", transform: "translateY(16px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "kr8-sheet-up": {
          from: { transform: "translateY(100%)" },
          to: { transform: "translateY(0)" },
        },
        "kr8-drawer-in": {
          from: { transform: "translateX(100%)" },
          to: { transform: "translateX(0)" },
        },
      },
      animation: {
        "kr8-in": "kr8-in 400ms cubic-bezier(0.32,0.72,0,1) both",
        "kr8-fade-up": "kr8-fade-up 700ms cubic-bezier(0.32,0.72,0,1) both",
        "kr8-sheet-up": "kr8-sheet-up 220ms cubic-bezier(0.32,0.72,0,1) both",
        "kr8-drawer-in": "kr8-drawer-in 200ms cubic-bezier(0.32,0.72,0,1) both",
      },
    },
  },
};

export default preset;
