import { NextRequest, NextResponse } from "next/server";
import { publicOrigin } from "@/lib/auth/social-sign-in";
import { handleStripeWebhook } from "@/lib/billing/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/billing/webhooks/stripe — Stripe's webhook. No session: the
// Stripe-Signature header over the raw body is the credential (middleware lets
// /api/billing/webhooks/ through). Answers 200 for a redelivered event and
// 5xx when handling fails, so Stripe retries.
export async function POST(req: NextRequest) {
  const payload = await req.text();
  try {
    const result = await handleStripeWebhook(payload, req.headers.get("stripe-signature"), publicOrigin(req));
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error("[billing] Stripe webhook failed", error);
    return NextResponse.json({ error: "Webhook handling failed." }, { status: 500 });
  }
}
