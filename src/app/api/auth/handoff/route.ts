import { NextRequest, NextResponse } from "next/server";
import { isNativeClient } from "@/lib/auth/constants";
import { jsonWithSession, responseFromAuthError, responseFromDbError } from "@/lib/auth/http";
import { redeemHandoff } from "@/lib/auth/identity";
import { createSession } from "@/lib/auth/session";
import { getUserSettings } from "@/lib/user-settings";

export const runtime = "nodejs";

// POST /api/auth/handoff — the app redeems a browser sign-in.
// Body: { code (from ciciro://oauth?code=), verifier (its PKCE verifier) }.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  try {
    const user = await redeemHandoff(body.code, body.verifier);
    const token = await createSession(user.id, req.headers.get("user-agent") || "");
    const settings = await getUserSettings(user.id);
    return jsonWithSession({ user, settings }, token, isNativeClient(req));
  } catch (error) {
    const mapped = responseFromAuthError(error) ?? responseFromDbError(error);
    if (mapped) return mapped;
    console.error("handoff failed", error);
    return NextResponse.json({ error: "Could not sign in." }, { status: 500 });
  }
}
