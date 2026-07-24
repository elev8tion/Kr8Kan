import { createTRPCReact } from "@trpc/react-query";
import type { inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "@kr8kan/api";

/** tRPC client — the sole data channel for the web UI. */
export const api = createTRPCReact<AppRouter>();

export type RouterOutputs = inferRouterOutputs<AppRouter>;

export function getBaseUrl(): string {
  if (typeof window !== "undefined") return "";
  return (
    process.env.NEXT_PUBLIC_BASE_URL ??
    `http://localhost:${process.env.KR8KAN_WEB_PORT ?? 3310}`
  );
}
