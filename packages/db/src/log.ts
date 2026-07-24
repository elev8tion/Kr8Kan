/** Tiny logger shim to avoid a hard dependency cycle with @kr8kan/logger. */
export function createLoggerSafe(): {
  warn: (obj: unknown, msg?: string) => void;
} {
  return {
    warn: (obj, msg) => console.warn("[kr8kan/db]", msg ?? "", obj),
  };
}
