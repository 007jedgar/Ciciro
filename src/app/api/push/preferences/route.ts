import { NextRequest, NextResponse } from "next/server";
import { AuthError, getSession } from "@/lib/auth/session";
import { responseFromAuthError, responseFromDbError } from "@/lib/auth/http";
import { getPushPreference, updatePushPreference, PUSH_CATEGORIES, type PushCategory } from "@/lib/push/preferences";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function patchFrom(body: Record<string, unknown>): Partial<Record<PushCategory, boolean>> {
  const patch: Partial<Record<PushCategory, boolean>> = {};
  for (const category of PUSH_CATEGORIES) {
    if (typeof body[category] === "boolean") patch[category] = body[category] as boolean;
  }
  return patch;
}

// GET /api/push/preferences — this account's per-category push toggles (all
// on when the account has never set any). Settings > Notifications reads
// this; sendPushToUser (src/lib/push/send.ts) checks the same table before
// every categorized send.
export async function GET(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session) throw new AuthError("Authentication required.", 401);
    return NextResponse.json(await getPushPreference(session.user.id));
  } catch (error) {
    const failure = responseFromAuthError(error) ?? responseFromDbError(error);
    if (failure) return failure;
    throw error;
  }
}

// PUT /api/push/preferences { shareComments?, writingNudge?, chatFinished? }
// — flip one or more categories. Unknown keys are ignored.
export async function PUT(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session) throw new AuthError("Authentication required.", 401);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const patch = patchFrom(body ?? {});
    return NextResponse.json(await updatePushPreference(session.user.id, patch));
  } catch (error) {
    const failure = responseFromAuthError(error) ?? responseFromDbError(error);
    if (failure) return failure;
    throw error;
  }
}
