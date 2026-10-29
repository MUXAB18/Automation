import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

// Pages anyone may open. Everything else needs a session cookie here and a verified session on
// the server (requireActor in every page, layout and server action).
const PUBLIC_PATHS = ["/login", "/forgot-password", "/reset-password"];
const isPublic = (pathname: string) =>
  PUBLIC_PATHS.includes(pathname) || pathname.startsWith("/invite/");

// Optimistic gate only: it checks that a session cookie exists. Real session and
// role checks happen on the server in requireActor() and every server action.
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSession = Boolean(getSessionCookie(request));

  if (pathname === "/login" || pathname === "/forgot-password") {
    return hasSession ? NextResponse.redirect(new URL("/", request.url)) : NextResponse.next();
  }
  if (isPublic(pathname)) return NextResponse.next();
  if (!hasSession) {
    const login = new URL("/login", request.url);
    if (pathname !== "/") login.searchParams.set("next", pathname + search);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
