import type { Auth, Session } from "@kr8kan/auth";
import { initAuth } from "@kr8kan/auth";
import type { Database } from "@kr8kan/db";
import { db, dbReady } from "@kr8kan/db";

/** Singleton better-auth instance shared by tRPC, REST, and the auth routes. */
const globalForAuth = globalThis as unknown as { kr8kanAuth?: Auth };

export function getAuth(): Auth {
  globalForAuth.kr8kanAuth ??= initAuth(db);
  return globalForAuth.kr8kanAuth;
}

export interface TRPCContext {
  db: Database;
  auth: Auth;
  session: Session | null;
  headers: Headers;
}

export async function createTRPCContext(opts: {
  headers: Headers;
}): Promise<TRPCContext> {
  await dbReady();
  // Install the workflow scheduler on the first request of any kind —
  // previously only agent/workflow routes installed it, so schedule and
  // card.due workflows (and the gate/reaper sweeps) stayed dormant after
  // a restart until someone happened to touch those routes.
  void import("./workflowEngine").then(({ ensureScheduler }) =>
    ensureScheduler(db),
  );
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: opts.headers });
  return { db, auth, session, headers: opts.headers };
}
