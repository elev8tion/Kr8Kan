import { useMediaQuery } from "./useMediaQuery";

/** Shell switch: below Tailwind `md` (768px) we are in mobile chrome —
 * bottom tab bar, sheets instead of drawers, snap-scroll board lists. */
export function useIsMobile(): boolean {
  return !useMediaQuery("(min-width: 768px)");
}
