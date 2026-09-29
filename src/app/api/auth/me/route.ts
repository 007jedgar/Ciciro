import { NextRequest, NextResponse } from "next/server";
import { isNativeClient } from "@/lib/auth/constants";
import { jsonWithSession } from "@/lib/auth/http";
import { getSession } from "@/lib/auth/session";
import { getUserSettings } from "@/lib/user-settings";

export const runtime = "nodejs";

// GET /api/auth/me: the current user, or null when not signed in. Echoes the
// token that matched (see getSession), so a phone always stores a valid one.
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ user: null, settings: null });
  const settings = await getUserSettings(session.user.id);
  return jsonWithSession({ user: session.user, settings }, session.token, isNativeClient(req));
}
