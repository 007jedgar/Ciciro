import { NextRequest, NextResponse } from "next/server";
import {
  applySessionHeaders,
  authRequired,
  hasRequestSession,
  SESSION_COOKIE,
  sessionTokenFromHeaders,
} from "@/lib/auth/constants";

// Auth enforcement is opt-in so the local-first single-author experience keeps
// working out of the box. Hosted deployments set CICIRO_REQUIRE_AUTH=true.

// Paths that never require a session. Beta reader links (/read/:token and
// /api/read/:token/...) carry their own credential, the share token.
const PUBLIC_PATHS = ["/login", "/signup", "/launch"];
const PUBLIC_PREFIXES = ["/api/auth/", "/api/health", "/read/", "/api/read/"];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function nextWithSession(req: NextRequest): NextResponse {
  const token = sessionTokenFromHeaders(
    req.headers,
    req.cookies.get(SESSION_COOKIE)?.value
  );
  if (!token) return NextResponse.next();
  return NextResponse.next({
    request: { headers: applySessionHeaders(new Headers(req.headers), token) },
  });
}

// Cheap gate: cookie *or* native x-ciciro-session header. React Native often
// cannot set the Cookie header, so cookie-only checks 401 a signed-in phone.
// Session validity is still verified in route handlers via getSessionUser.
export function middleware(req: NextRequest) {
  if (!authRequired()) return nextWithSession(req);

  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return nextWithSession(req);

  const hasSession = hasRequestSession(
    req.headers,
    req.cookies.get(SESSION_COOKIE)?.value
  );
  if (hasSession) return nextWithSession(req);

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(loginUrl);
}

// Exclude Next internals and static assets from the middleware.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)"],
};
