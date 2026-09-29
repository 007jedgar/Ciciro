import { NextRequest, NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth/session";
import { responseFromAuthError } from "@/lib/auth/http";
import { publicOrigin } from "@/lib/public-origin";
import { createCheckoutSession } from "@/lib/billing/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/billing/checkout — { interval: "month" | "year" } → { url } of a
// Stripe Checkout page for Ciciro Pro. 409 while any subscription (web or
// store) is active, so an account is never billed twice.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const interval = body?.interval === "year" ? "year" : body?.interval === "month" ? "month" : null;
  if (!interval) return NextResponse.json({ error: "interval must be month or year" }, { status: 400 });
  try {
    const user = await requireSessionUser(req);
    const url = await createCheckoutSession(user, interval, publicOrigin(req.nextUrl.origin));
    return NextResponse.json({ url });
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
}
