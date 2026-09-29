import { NextRequest, NextResponse } from "next/server";
import { isNativeClient } from "@/lib/auth/constants";
import { jsonWithSession, responseFromAuthError, responseFromDbError } from "@/lib/auth/http";
import { AuthError, authenticate, createSession } from "@/lib/auth/session";
import { normalizeEmail } from "@/lib/auth/tokens";
import { assertAttemptAllowed, clearAttempts, recordFailedAttempt } from "@/lib/auth/rate-limit";
import { clientAddress } from "@/lib/request-ip";
import { getUserSettings } from "@/lib/user-settings";

export const runtime = "nodejs";

// POST /api/auth/login — verify credentials and start a session.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const address = clientAddress(req);
  // A key even for an email with no account, so a guess against one locks
  // out the same way a guess against a real account does.
  const key = normalizeEmail(body.email) ?? "invalid";
  try {
    await assertAttemptAllowed("login", key, address);
    const user = await authenticate({ email: body.email, password: body.password });
    await clearAttempts("login", key);
    const token = await createSession(user.id, req.headers.get("user-agent") || "");
    const settings = await getUserSettings(user.id);
    return jsonWithSession({ user, settings }, token, isNativeClient(req));
  } catch (error) {
    if (error instanceof AuthError && error.status === 401) {
      try {
        await recordFailedAttempt("login", key, address);
      } catch (recordError) {
        console.error("login rate-limit record failed", recordError);
      }
    }
    const failure = responseFromAuthError(error) ?? responseFromDbError(error);
    if (failure) return failure;
    console.error("login failed", error);
    return NextResponse.json({ error: "Could not sign in." }, { status: 500 });
  }
}
