import { NextRequest, NextResponse } from "next/server";
import { responseFromAuthError, responseFromDbError } from "@/lib/auth/http";
import { verifyEmail } from "@/lib/auth/verify-email";
import { publicOrigin } from "@/lib/public-origin";

export const runtime = "nodejs";

// POST /api/auth/verify-email: { token }. Spends a confirmation link. Only
// this explicit POST verifies; opening the emailed link (a mail scanner
// does) just looks it up.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const outcome = await verifyEmail(body.token, publicOrigin(req.nextUrl.origin));
    return NextResponse.json({ ok: outcome === "verified" || outcome === "already_verified", outcome });
  } catch (error) {
    const failure = responseFromAuthError(error) ?? responseFromDbError(error);
    if (failure) return failure;
    console.error("verify email failed", error);
    return NextResponse.json({ error: "Could not confirm your email. Try again." }, { status: 500 });
  }
}
