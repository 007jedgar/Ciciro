import type { Entitlement } from "@/lib/entitlements";

// Browser-side billing helpers: the limit-reached signal every AI surface
// raises, and the calls that leave for Stripe. The server decides everything;
// these only render what /api/billing/entitlement and the 402s say.

export type { Entitlement };

/** Fired on window with the entitlement when an AI request comes back 402. */
export const AI_LIMIT_EVENT = "ciciro:ai-limit";

export type AiLimitDetail = { message: string; entitlement: Entitlement | null };

/**
 * If `status`/`data` is the server's "allowance used up" answer, tell the app
 * (AiLimitDialog shows it) and return true. Call it wherever an AI request's
 * JSON error is read, before showing the error inline.
 */
export function reportAiLimit(status: number, data: unknown): boolean {
  const body = (data ?? {}) as { code?: unknown; error?: unknown; entitlement?: unknown };
  if (status !== 402 || body.code !== "ai_limit_reached") return false;
  const detail: AiLimitDetail = {
    message: typeof body.error === "string" ? body.error : "You've used this month's AI allowance.",
    entitlement: (body.entitlement as Entitlement | undefined) ?? null,
  };
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(AI_LIMIT_EVENT, { detail }));
  return true;
}

/** "October 1" (or "Oct 1"): when the allowance for `period` ("YYYY-MM") starts over. */
export function allowanceResetsOn(period: string, month: "long" | "short" = "long"): string {
  const [year, index] = period.split("-").map(Number);
  const next = new Date(Date.UTC(year, index, 1));
  return next.toLocaleDateString(undefined, { month, day: "numeric", timeZone: "UTC" });
}

/** "September 30, 2026" for an ISO time. */
export function billingDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

export async function fetchEntitlement(): Promise<Entitlement | null> {
  const res = await fetch("/api/billing/entitlement", { credentials: "include", cache: "no-store" });
  if (!res.ok) return null;
  return ((await res.json()) as { entitlement: Entitlement }).entitlement;
}

export type BillingRedirect = { url: string } | { error: string; manageUrl?: string | null };

async function redirectFrom(path: string, body?: unknown): Promise<BillingRedirect> {
  try {
    const res = await fetch(path, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string; manageUrl?: string | null };
    if (res.ok && data.url) return { url: data.url };
    return { error: data.error || "Billing is unavailable right now. Try again.", manageUrl: data.manageUrl };
  } catch {
    return { error: "Could not reach Ciciro. Check your connection and try again." };
  }
}

/** A Stripe Checkout page for Ciciro Pro, or why not (already subscribed, and where). */
export function startCheckout(interval: "month" | "year"): Promise<BillingRedirect> {
  return redirectFrom("/api/billing/checkout", { interval });
}

/** The Stripe Customer Portal for a web subscriber. */
export function openBillingPortal(): Promise<BillingRedirect> {
  return redirectFrom("/api/billing/portal");
}

/** "App Store" / "Google Play" for a store subscription. */
export function storeName(source: Entitlement["source"]): string | null {
  if (source === "app_store") return "the App Store";
  if (source === "play_store") return "Google Play";
  return null;
}
