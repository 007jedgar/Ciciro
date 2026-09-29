import { NextRequest, NextResponse } from "next/server";
import { isNativeClient } from "@/lib/auth/constants";
import { jsonWithSession, responseFromAuthError, responseFromDbError } from "@/lib/auth/http";
import { createSession } from "@/lib/auth/session";
import { signInWithAppleNative } from "@/lib/auth/social-sign-in";
import { getUserSettings } from "@/lib/user-settings";

export const runtime = "nodejs";

// POST /api/auth/apple/native — the iOS Sign in with Apple sheet.
// Body: { idToken, nonce (raw), authorizationCode?, givenName?, familyName? }.
// Apple sends the name only on the first authorization, so the app forwards it.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  try {
    const user = await signInWithAppleNative({
      idToken: body.idToken,
      nonce: body.nonce,
      authorizationCode: body.authorizationCode,
      givenName: body.givenName,
      familyName: body.familyName,
    });
    const token = await createSession(user.id, req.headers.get("user-agent") || "");
    const settings = await getUserSettings(user.id);
    return jsonWithSession({ user, settings }, token, isNativeClient(req));
  } catch (error) {
    const mapped = responseFromAuthError(error) ?? responseFromDbError(error);
    if (mapped) return mapped;
    console.error("apple native sign-in failed", error);
    return NextResponse.json({ error: "Could not sign in." }, { status: 500 });
  }
}
