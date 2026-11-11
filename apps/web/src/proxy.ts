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
  // Tell server components which page is being rendered. Always overwritten here, so a client
  // cannot supply its own value. The dashboard layout uses it to answer 404 before streaming starts.
  const forwarded = new Headers(request.headers);
  forwarded.set("x-pathname", pathname);
  const next = () => NextResponse.next({ request: { headers: forwarded } });
  const hasSession = Boolean(getSessionCookie(request));

  if (pathname === "/login" || pathname === "/forgot-password") {
    return hasSession ? NextResponse.redirect(new URL("/", request.url)) : next();
  }
  if (isPublic(pathname)) return next();
  if (!hasSession) {
    const login = new URL("/login", request.url);
    if (pathname !== "/") login.searchParams.set("next", pathname + search);
    return NextResponse.redirect(login);
  }
  return next();
}

export const config = {
  matcher: ["/((?!api/auth|api/health|_next/static|_next/image|favicon.ico).*)"],
};
