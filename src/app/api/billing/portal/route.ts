import { NextRequest, NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth/session";
import { responseFromAuthError } from "@/lib/auth/http";
import { publicOrigin } from "@/lib/auth/social-sign-in";
import { createPortalSession } from "@/lib/billing/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/billing/portal — { url } of the Stripe Customer Portal, where a web
// subscriber changes plan or card, sees invoices, or cancels.
export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser(req);
    return NextResponse.json({ url: await createPortalSession(user, publicOrigin(req)) });
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
}
