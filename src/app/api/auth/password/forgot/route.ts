import { NextRequest, NextResponse } from "next/server";
import { responseFromAuthError, responseFromDbError } from "@/lib/auth/http";
import { requestPasswordReset } from "@/lib/auth/password-reset";
import { publicOrigin } from "@/lib/public-origin";

export const runtime = "nodejs";

// POST /api/auth/password/forgot — { email }. Emails a reset link when the
// address has an account. Answers { ok: true } either way, so it never says
// whether an address is registered.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    await requestPasswordReset(body.email, publicOrigin(req.nextUrl.origin));
    return NextResponse.json({ ok: true });
  } catch (error) {
    const failure = responseFromAuthError(error) ?? responseFromDbError(error);
    if (failure) return failure;
    console.error("password reset request failed", error);
    return NextResponse.json({ error: "Could not send the email. Try again." }, { status: 500 });
  }
}
