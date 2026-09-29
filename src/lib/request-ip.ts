import { NextRequest } from "next/server";

/**
 * The caller's address, for rate limiting, or null when it cannot be trusted.
 * Only cf-connecting-ip is read: Cloudflare sets it and overwrites any a client
 * sent. x-real-ip and x-forwarded-for are client-spoofable without a trusted
 * proxy, so they are ignored. Per-IP limiting therefore needs a proxy that sets
 * a real client-IP header; on other hosts callers get account-only protection.
 */
export function clientAddress(req: NextRequest): string | null {
  return req.headers.get("cf-connecting-ip")?.trim() || null;
}
