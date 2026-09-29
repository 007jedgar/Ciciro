import { NextRequest } from "next/server";

/**
 * The caller's address, for rate limiting. Cloudflare sets cf-connecting-ip
 * and overwrites any a client sent; the others are for other hosts, where a
 * proxy in front must set them. Without one, callers share a single budget.
 */
export function clientAddress(req: NextRequest): string {
  const cf = req.headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "unknown";
}
