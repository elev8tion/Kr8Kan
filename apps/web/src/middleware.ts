import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * Self-host routing: `/` goes straight to the product — `/boards` with a
 * session, `/login` without. There is no cloud marketing branch and no
 * NEXT_PUBLIC_KAN_ENV switch, by design.
 */
const SESSION_COOKIE = "kr8kan.session_token";
const PUBLIC_PATHS = ["/login", "/signup", "/invite"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(
    request.cookies.get(SESSION_COOKIE)?.value ??
      request.cookies.get(`__Secure-${SESSION_COOKIE}`)?.value,
  );

  if (pathname === "/") {
    return NextResponse.redirect(
      new URL(hasSession ? "/boards" : "/login", request.url),
    );
  }

  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
  if (!hasSession && !isPublic) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }
  if (hasSession && (pathname === "/login" || pathname === "/signup")) {
    return NextResponse.redirect(new URL("/boards", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico|webmanifest)).*)",
  ],
};
