import { NextRequest, NextResponse } from "next/server";
import { responseFromAuthError, responseFromDbError } from "@/lib/auth/http";
import { requireSessionUser } from "@/lib/auth/session";
import { startEmailVerification } from "@/lib/auth/verify-email";
import { publicOrigin } from "@/lib/public-origin";

export const runtime = "nodejs";

// POST /api/auth/verify-email/resend: email the signed-in account a fresh
// link to verify its address. 429 with Retry-After inside the cooldown.
export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser(req);
    const result = await startEmailVerification(user.id, publicOrigin(req.nextUrl.origin));
    if (result.status === "cooldown") {
      const seconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
      return NextResponse.json(
        {
          error: `A link just went out. You can send another in ${seconds} ${seconds === 1 ? "second" : "seconds"}.`,
          retryAfterSeconds: seconds,
        },
        { status: 429, headers: { "retry-after": String(seconds) } }
      );
    }
    return NextResponse.json({ ok: true, status: result.status });
  } catch (error) {
    const failure = responseFromAuthError(error) ?? responseFromDbError(error);
    if (failure) return failure;
    console.error("resend verification failed", error);
    return NextResponse.json({ error: "Could not send the email. Try again." }, { status: 500 });
  }
}
