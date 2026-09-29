import { NextResponse } from "next/server";
import { socialAvailability } from "@/lib/auth/social-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/auth/providers — which Sign in with Apple / Google buttons to show.
// The app reads this; the web login page reads the same config server-side.
export async function GET() {
  return NextResponse.json(socialAvailability(), { headers: { "cache-control": "no-store" } });
}
