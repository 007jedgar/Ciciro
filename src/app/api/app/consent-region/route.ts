import { NextResponse } from "next/server";
import { requestGeo } from "@/lib/request-geo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/app/consent-region — the caller's coarse country (and US state),
// from Cloudflare, so the phone can tell whether it must ask for analytics
// consent before running (apps/mobile/lib/consent-region.ts holds the
// rule). Public: the app asks before, and regardless of, sign-in. The reply
// is derived from the request's IP, never stored or logged, and never cached
// by a shared cache since it differs per caller.
export async function GET(request: Request) {
  return NextResponse.json(requestGeo(request), {
    headers: { "cache-control": "private, no-store" },
  });
}
