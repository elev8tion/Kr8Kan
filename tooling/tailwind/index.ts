import type { Config } from "tailwindcss";

/**
 * Kr8Kan shared Tailwind preset — maps the `--kr8-*` design tokens
 * (defined in apps/web/src/styles/globals.css) onto semantic utilities:
 *   bg-kr8-bg, bg-kr8-bg-elevated, text-kr8-fg-muted, border-kr8-border,
 *   bg-kr8-accent text-kr8-accent-fg, rounded-kr8-md, shadow-kr8-sm, …
 */
const preset: Omit<Config, "content"> = {
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        kr8: {
          bg: "var(--kr8-bg)",
          "bg-elevated": "var(--kr8-bg-elevated)",
          "bg-muted": "var(--kr8-bg-muted)",
          fg: "var(--kr8-fg)",
          "fg-muted": "var(--kr8-fg-muted)",
          border: "var(--kr8-border)",
          accent: "var(--kr8-accent)",
          "accent-fg": "var(--kr8-accent-fg)",
          danger: "var(--kr8-danger)",
          warning: "var(--kr8-warning)",
          success: "var(--kr8-success)",
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
      },
      fontFamily: {
        sans: "var(--kr8-font-sans)",
        mono: "var(--kr8-font-mono)",
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
        "kr8-in": "kr8-in 180ms ease-out both",
        "kr8-sheet-up": "kr8-sheet-up 220ms cubic-bezier(0.32,0.72,0,1) both",
        "kr8-drawer-in": "kr8-drawer-in 200ms cubic-bezier(0.32,0.72,0,1) both",
      },
    },
  },
};

export default preset;
