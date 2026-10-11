import { NextResponse } from "next/server";
import { getVersionPolicy } from "@/lib/app-version-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/app/version-policy — per-platform minimum (and optional latest)
// app version, for the mobile forced-update gate. Public: the app must be
// able to check this before, and regardless of, sign-in. See
// src/lib/app-version-policy.ts and docs/mobile-release.md.
export async function GET() {
  return NextResponse.json(getVersionPolicy(), { headers: { "cache-control": "no-store" } });
}
