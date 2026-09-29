import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireSessionUser } from "@/lib/auth/session";
import { responseFromAuthError } from "@/lib/auth/http";
import { revenueCatSettings } from "@/lib/billing/config";
import { syncRevenueCatUser } from "@/lib/billing/revenuecat";
import { getEntitlement } from "@/lib/entitlements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/billing/sync — re-read the signed-in account's store purchases
// from RevenueCat and return the entitlement. The app calls it right after a
// purchase or Restore Purchases, so Pro turns on without waiting for the
// webhook. The server still decides: nothing the app reports is trusted.
export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser(req);
    const settings = revenueCatSettings();
    if (!settings) throw new AuthError("Store billing is not available.", 404);
    await syncRevenueCatUser(user.id, settings);
    return NextResponse.json({ entitlement: await getEntitlement(user.id) });
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
}
