import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_HEADER,
  isNativeClient,
  tokenFromCookieHeader,
} from "@/lib/auth/constants";
import { jsonWithSession } from "@/lib/auth/http";
import { getSessionUser } from "@/lib/auth/session";
import { getUserSettings } from "@/lib/user-settings";

export const runtime = "nodejs";

// GET /api/auth/me — the current user, or null when not signed in.
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ user: null, settings: null });
  const settings = await getUserSettings(user.id);
  const token =
    req.cookies.get(SESSION_COOKIE)?.value ||
    req.headers.get(SESSION_HEADER) ||
    tokenFromCookieHeader(req.headers.get("cookie")) ||
    "";
  return jsonWithSession({ user, settings }, token, isNativeClient(req));
}
