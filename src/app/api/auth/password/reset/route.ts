import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/constants";
import { responseFromAuthError, responseFromDbError } from "@/lib/auth/http";
import { resetPassword } from "@/lib/auth/password-reset";

export const runtime = "nodejs";

// POST /api/auth/password/reset — { token, password }. Sets the new password
// and signs the account out everywhere, this browser included.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    await resetPassword(body.token, body.password);
  } catch (error) {
    const failure = responseFromAuthError(error) ?? responseFromDbError(error);
    if (failure) return failure;
    console.error("password reset failed", error);
    return NextResponse.json({ error: "Could not reset your password. Try again." }, { status: 500 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
