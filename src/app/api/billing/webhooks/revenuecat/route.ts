import { NextRequest, NextResponse } from "next/server";
import { handleRevenueCatWebhook } from "@/lib/billing/revenuecat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/billing/webhooks/revenuecat — RevenueCat's webhook. No session:
// the Authorization header set in the RevenueCat dashboard is the credential.
// RevenueCat waits 60 seconds and retries a failure up to 5 times.
export async function POST(req: NextRequest) {
  const payload = await req.json().catch(() => null);
  const result = await handleRevenueCatWebhook(req.headers.get("authorization"), payload);
  return NextResponse.json(result.body, { status: result.status });
}
