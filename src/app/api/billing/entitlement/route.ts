import { NextRequest, NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth/session";
import { responseFromAuthError } from "@/lib/auth/http";
import { getEntitlement } from "@/lib/entitlements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/billing/entitlement — the signed-in account's plan, AI usage this
// month, and what this server can sell. Web and the apps render from this.
export async function GET(req: NextRequest) {
  try {
    const user = await requireSessionUser(req);
    return NextResponse.json({ entitlement: await getEntitlement(user.id) });
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
}
