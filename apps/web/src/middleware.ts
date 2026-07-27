import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * Self-host routing: `/` goes straight to the product — `/boards` with a
 * session, `/login` without. There is no cloud marketing branch and no
 * NEXT_PUBLIC_KAN_ENV switch, by design.
 *
 * Sessions are VALIDATED here, not just presence-checked: a stale cookie
 * whose session row is gone (wiped store, rotated secret) used to bounce
 * the user into a dashboard shell where every query failed and sign-out
 * 403'd — a trap with no exit, since the cookies are httpOnly. Now a
 * dead cookie is expired right on the redirect response, at the door.
 */
const SESSION_COOKIE = "kr8kan.session_token";
const AUTH_COOKIES = [
  "kr8kan.session_token",
  "kr8kan.session_data",
  "__Secure-kr8kan.session_token",
  "__Secure-kr8kan.session_data",
];
const PUBLIC_PATHS = [
  "/login",
  "/signup",
  "/invite",
  "/p/",
  "/forgot-password",
  "/reset-password",
];

/** Ask better-auth whether the cookie belongs to a live session. */
async function sessionIsValid(request: NextRequest): Promise<boolean> {
  try {
    const res = await fetch(
      new URL("/api/auth/get-session", request.nextUrl.origin),
      {
        headers: { cookie: request.headers.get("cookie") ?? "" },
        // Session checks must never hang navigation behind a slow store.
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!res.ok) return false;
    const data = (await res.json()) as { user?: unknown } | null;
    return Boolean(data?.user);
  } catch {
    // Store unreachable: fail open to the app shell rather than bouncing
    // a possibly-valid session to /login — the tRPC layer still enforces
    // auth on every actual data access.
    return true;
  }
}

function expireAuthCookies(response: NextResponse): NextResponse {
  for (const name of AUTH_COOKIES) {
    response.cookies.set(name, "", { path: "/", maxAge: 0, httpOnly: true });
  }
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasCookie = Boolean(
    request.cookies.get(SESSION_COOKIE)?.value ??
      request.cookies.get(`__Secure-${SESSION_COOKIE}`)?.value,
  );
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  // No cookie: public pages render, everything else goes to /login.
  if (!hasCookie) {
    if (pathname === "/") {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    if (isPublic) return NextResponse.next();
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  // Cookie present: validate it before treating the user as signed in.
  const valid = await sessionIsValid(request);
  if (!valid) {
    // Ghost session. Public pages (login/signup/invite/reset) must still
    // render — bouncing a signup attempt to /login reads as "the app
    // won't let me create an account". Expire the cookies either way.
    if (isPublic) return expireAuthCookies(NextResponse.next());
    const login = new URL("/login", request.url);
    if (pathname !== "/") login.searchParams.set("next", pathname);
    return expireAuthCookies(NextResponse.redirect(login));
  }

  if (pathname === "/") {
    return NextResponse.redirect(new URL("/boards", request.url));
  }
  if (pathname === "/login" || pathname === "/signup") {
    return NextResponse.redirect(new URL("/boards", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico|webmanifest)).*)",
  ],
};
