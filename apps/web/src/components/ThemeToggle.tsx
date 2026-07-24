import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { HiMoon, HiSun } from "react-icons/hi2";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) {
    return <span className="h-11 w-11 md:h-9 md:w-9" aria-hidden />;
  }
  const dark = resolvedTheme === "dark";
  return (
    <button
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      className="flex h-11 w-11 items-center justify-center rounded-kr8-sm text-kr8-fg-muted hover:bg-kr8-bg-muted hover:text-kr8-fg md:h-9 md:w-9"
    >
      {dark ? <HiSun className="h-5 w-5" /> : <HiMoon className="h-5 w-5" />}
    </button>
  );
}
