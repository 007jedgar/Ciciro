import { NextRequest, NextResponse } from "next/server";
import { clientPlatform, isNativeClient } from "@/lib/auth/constants";
import { jsonWithSession, responseFromDbError } from "@/lib/auth/http";
import { AuthError, createSession, registerUser } from "@/lib/auth/session";
import { afterPasswordSignup } from "@/lib/auth/verify-email";
import { publicOrigin } from "@/lib/public-origin";
import { getUserSettings } from "@/lib/user-settings";
import { sendWelcomeStep1 } from "@/lib/email/welcome-sequence";
import { captureServerEvent } from "@/lib/analytics-server";
import { waitUntilRequest } from "@/lib/db";

export const runtime = "nodejs";

// POST /api/auth/signup: create an account, start a session, and email a
// link to verify the address (the welcome email follows once it is verified).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  try {
    const user = await registerUser({
      email: body.email,
      password: body.password,
      name: body.name,
      marketingOptIn: body.marketingOptIn,
    });
    const token = await createSession(user.id, req.headers.get("user-agent") || "");
    const origin = publicOrigin(req.nextUrl.origin);
    await afterPasswordSignup(user.id, origin);
    if (body.marketingOptIn === true) {
      await sendWelcomeStep1(user, origin).catch((error) => console.error("welcome step 1 failed", error));
    }
    const settings = await getUserSettings(user.id);
    const native = isNativeClient(req);
    waitUntilRequest(
      captureServerEvent(user.id, "account_created", {
        method: "email",
        platform: clientPlatform(req),
      })
    );
    return jsonWithSession({ user, settings }, token, native, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const mapped = responseFromDbError(error);
    if (mapped) return mapped;
    console.error("signup failed", error);
    return NextResponse.json({ error: "Could not create account." }, { status: 500 });
  }
}
