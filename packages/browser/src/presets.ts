/**
 * Viewport presets, matching the Chrome DevTools device toolbar so
 * responsive pages behave the way developers already expect.
 *
 * Lifted from dodis-browser `src/shared/viewport-presets.ts` (MIT) — see
 * NOTICE. It was dead code there (defined, never referenced); here it backs
 * the `preset` option on screenshots, which is what makes the mobile
 * breakpoints in the visual QA checklist checkable.
 */

export type ViewportPresetId =
  | "mobile-s"
  | "mobile-m"
  | "mobile-l"
  | "tablet"
  | "laptop"
  | "laptop-l"
  | "desktop";

export interface ViewportPreset {
  id: ViewportPresetId;
  label: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
  mobile: boolean;
}

export const VIEWPORT_PRESETS: readonly ViewportPreset[] = [
  {
    id: "mobile-s",
    label: "Mobile S — 320 × 568",
    width: 320,
    height: 568,
    deviceScaleFactor: 2,
    mobile: true,
  },
  {
    id: "mobile-m",
    label: "Mobile M — 375 × 667",
    width: 375,
    height: 667,
    deviceScaleFactor: 2,
    mobile: true,
  },
  {
    id: "mobile-l",
    label: "Mobile L — 425 × 812",
    width: 425,
    height: 812,
    deviceScaleFactor: 2,
    mobile: true,
  },
  {
    id: "tablet",
    label: "Tablet — 768 × 1024",
    width: 768,
    height: 1024,
    deviceScaleFactor: 2,
    mobile: true,
  },
  {
    id: "laptop",
    label: "Laptop — 1024 × 768",
    width: 1024,
    height: 768,
    deviceScaleFactor: 1,
    mobile: false,
  },
  {
    id: "laptop-l",
    label: "Laptop L — 1440 × 900",
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  },
  {
    id: "desktop",
    label: "Desktop — 1920 × 1080",
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
  },
] as const;

export function getViewportPreset(
  id: string | null | undefined,
): ViewportPreset | null {
  if (!id) return null;
  return VIEWPORT_PRESETS.find((p) => p.id === id) ?? null;
}
