import { NextRequest, NextResponse } from "next/server";
import { isNativeClient } from "@/lib/auth/constants";
import { jsonWithSession } from "@/lib/auth/http";
import { getSession } from "@/lib/auth/session";
import { getUserSettings } from "@/lib/user-settings";
import { getEntitlement } from "@/lib/entitlements";

export const runtime = "nodejs";

// GET /api/auth/me: the current user, or null when not signed in, with their
// synced settings and billing entitlement (null if billing cannot be read, so
// a billing outage never signs anyone out). Echoes the token that matched
// (see getSession), so a phone always stores a valid one.
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ user: null, settings: null, entitlement: null });
  const [settings, entitlement] = await Promise.all([
    getUserSettings(session.user.id),
    getEntitlement(session.user.id).catch((error) => {
      console.error("auth/me: entitlement unavailable", error);
      return null;
    }),
  ]);
  return jsonWithSession({ user: session.user, settings, entitlement }, session.token, isNativeClient(req));
}
