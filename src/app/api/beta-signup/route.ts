import { NextRequest, NextResponse } from "next/server";
import { responseFromAuthError, responseFromDbError } from "@/lib/auth/http";
import { BETA_HONEYPOT_FIELD, joinBeta } from "@/lib/beta-signup";
import { clientAddress } from "@/lib/request-ip";

export const runtime = "nodejs";

// POST /api/beta-signup: { email, source?, website? }. Public: the landing
// page's iOS TestFlight beta form. `website` is the honeypot. Answers
// { ok: true } for a new address, a repeat, or a bot alike.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    await joinBeta(body.email, {
      address: clientAddress(req),
      source: typeof body.source === "string" ? body.source : undefined,
      honeypot: body[BETA_HONEYPOT_FIELD],
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const failure = responseFromAuthError(error) ?? responseFromDbError(error);
    if (failure) return failure;
    console.error("beta signup failed", error);
    return NextResponse.json({ error: "Could not sign you up. Try again." }, { status: 500 });
  }
}
