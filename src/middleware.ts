import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/tokens";

// Auth enforcement is opt-in so the local-first single-author experience keeps
// working out of the box. Hosted deployments set CICIRO_REQUIRE_AUTH=true.
const REQUIRE_AUTH = process.env.CICIRO_REQUIRE_AUTH === "true";

// Paths that never require a session.
const PUBLIC_PATHS = ["/login", "/signup"];
const PUBLIC_API_PREFIXES = ["/api/auth/", "/api/health"];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  return PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

// Cheap gate: this only checks for cookie presence to redirect obvious
// anonymous traffic. Session validity is verified in route handlers and server
// components via getSessionUser (middleware runs on the edge without DB access).
export function middleware(req: NextRequest) {
  if (!REQUIRE_AUTH) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const hasSession = Boolean(req.cookies.get(SESSION_COOKIE)?.value);
  if (hasSession) return NextResponse.next();

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
