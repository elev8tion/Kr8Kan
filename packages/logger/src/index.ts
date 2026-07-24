import pino from "pino";

/**
 * Kr8Kan logging: pino to stdout (pretty in dev), optional file via LOG_FILE.
 * No cloud log sinks — Axiom and friends are intentionally absent.
 */

const level = process.env.LOG_LEVEL ?? "info";
const logFile = process.env.LOG_FILE;
const isDev = process.env.NODE_ENV !== "production";

function buildRoot(): pino.Logger {
  if (logFile) {
    return pino(
      { level },
      pino.transport({
        targets: [
          { target: "pino/file", options: { destination: 1 } },
          { target: "pino/file", options: { destination: logFile, mkdir: true } },
        ],
      }),
    );
  }
  if (isDev) {
    try {
      return pino({
        level,
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss" },
        },
      });
    } catch {
      // pino-pretty not installed in prod images — fall through to stdout JSON
    }
  }
  return pino({ level });
}

const root = buildRoot();

export function createLogger(module: string): pino.Logger {
  return root.child({ module });
}

export type Logger = pino.Logger;
