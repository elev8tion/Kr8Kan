import { authClient } from "@kr8kan/auth/client";

/**
 * Sign out that always works. better-auth's /sign-out 403s when the
 * session row no longer exists, and the cookies are httpOnly — so after
 * the polite attempt, unconditionally expire the cookies server-side and
 * hard-navigate to /login (a full navigation so the middleware re-runs
 * against the cleared cookie state).
 */
export async function signOutEverywhere(): Promise<void> {
  try {
    await authClient.signOut();
  } catch {
    // dead session — the reset below still clears the cookies
  }
  try {
    await fetch("/api/session-reset", { method: "POST" });
  } catch {
    // unreachable server: nothing more we can do client-side
  }
  window.location.href = "/login";
}
