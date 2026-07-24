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
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: opts.headers });
  return { db, auth, session, headers: opts.headers };
}
