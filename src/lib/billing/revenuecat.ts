import { prisma, waitUntilRequest } from "@/lib/db";
import { revenueCatSettings, type RevenueCatSettings } from "@/lib/billing/config";
import { attributeBillingEvent, handleOnce } from "@/lib/billing/events";
import { captureServerEvent } from "@/lib/analytics-server";

// App Store and Google Play subscriptions, through RevenueCat. The app logs in
// to RevenueCat with the Ciciro user id (Purchases.logIn), so a RevenueCat
// app user id is a User.id. RevenueCat is used for the stores only: Stripe
// reaches this server directly (src/lib/billing/stripe.ts).
//
// Webhooks are a nudge, not the record: each one re-fetches the customer from
// RevenueCat's REST API and stores what it says now, so duplicate and
// out-of-order deliveries (RevenueCat retries up to 5 times) settle the same.

/** One entry of a v1 subscriber's `subscriptions` map. */
export type RevenueCatSubscription = {
  expires_date: string | null;
  purchase_date?: string | null;
  store: string;
  is_sandbox?: boolean;
  unsubscribe_detected_at?: string | null;
  billing_issues_detected_at?: string | null;
  refunded_at?: string | null;
  grace_period_expires_date?: string | null;
};

export type RevenueCatSubscriber = {
  original_app_user_id?: string;
  subscriptions?: Record<string, RevenueCatSubscription>;
  entitlements?: Record<string, { expires_date: string | null; product_identifier: string }>;
};

const STORE_SOURCES: Record<string, "app_store" | "play_store"> = {
  app_store: "app_store",
  mac_app_store: "app_store",
  play_store: "play_store",
};

/** A RevenueCat id that is not a Ciciro account (the SDK's anonymous ids). */
function isAnonymous(appUserId: string): boolean {
  return appUserId.startsWith("$RCAnonymousID:");
}

/** Compare the Authorization header to the configured value in constant time. */
export function revenueCatAuthorized(header: string | null, settings: RevenueCatSettings): boolean {
  if (!header) return false;
  const encoder = new TextEncoder();
  const a = encoder.encode(header);
  const b = encoder.encode(settings.webhookAuthorization);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/** GET /v1/subscribers/:id. Throws on a failed request so the webhook is retried. */
export async function fetchSubscriber(
  appUserId: string,
  settings: RevenueCatSettings
): Promise<RevenueCatSubscriber> {
  const res = await fetch(`${settings.apiBase}/v1/subscribers/${encodeURIComponent(appUserId)}`, {
    headers: { Authorization: `Bearer ${settings.secretApiKey}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`RevenueCat subscriber lookup failed with status ${res.status}`);
  const body = (await res.json()) as { subscriber?: RevenueCatSubscriber };
  return body.subscriber ?? {};
}

function time(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Map one store subscription onto Stripe's status words. */
export function storeStatus(sub: RevenueCatSubscription, now = new Date()): string {
  if (sub.refunded_at) return "canceled";
  const grace = time(sub.grace_period_expires_date);
  const expires = time(sub.expires_date);
  const end = grace && expires && grace > expires ? grace : expires;
  if (end && end.getTime() <= now.getTime()) return "expired";
  if (sub.billing_issues_detected_at) return "past_due";
  return "active";
}

function storeEnd(sub: RevenueCatSubscription): Date | null {
  const grace = time(sub.grace_period_expires_date);
  const expires = time(sub.expires_date);
  return grace && (!expires || grace > expires) ? grace : expires;
}

/**
 * Store what RevenueCat says about an account's store subscriptions. A store
 * row RevenueCat no longer lists (a purchase transferred to another account)
 * is marked expired.
 */
export async function applySubscriber(
  userId: string,
  subscriber: RevenueCatSubscriber,
  settings: RevenueCatSettings,
  now = new Date()
): Promise<void> {
  const seen: string[] = [];
  for (const [productId, sub] of Object.entries(subscriber.subscriptions ?? {})) {
    const source = STORE_SOURCES[sub.store];
    if (!source) continue; // Stripe (billed here directly) and promotional grants.
    const externalId = `revenuecat:${userId}:${productId}`;
    seen.push(externalId);
    const data = {
      userId,
      source,
      productId,
      plan: "pro",
      interval: settings.yearlyProductIds.includes(productId) ? "year" : "month",
      status: storeStatus(sub, now),
      currentPeriodEnd: storeEnd(sub),
      cancelAtPeriodEnd: Boolean(sub.unsubscribe_detected_at),
      sandbox: Boolean(sub.is_sandbox),
    };
    await prisma.subscription.upsert({ where: { externalId }, create: { externalId, ...data }, update: data });
  }
  await prisma.subscription.updateMany({
    where: {
      userId,
      source: { in: ["app_store", "play_store"] },
      externalId: { notIn: seen },
      status: { not: "expired" },
    },
    data: { status: "expired", cancelAtPeriodEnd: false },
  });
}

/** Re-fetch one RevenueCat customer and store their subscriptions. False when not an account. */
export async function syncRevenueCatUser(appUserId: string, settings: RevenueCatSettings): Promise<boolean> {
  if (!appUserId || isAnonymous(appUserId)) return false;
  const user = await prisma.user.findUnique({ where: { id: appUserId }, select: { id: true } });
  if (!user) return false;
  await applySubscriber(user.id, await fetchSubscriber(user.id, settings), settings);
  return true;
}

export type RevenueCatEvent = {
  id?: string;
  type?: string;
  app_user_id?: string;
  original_app_user_id?: string;
  aliases?: string[];
  transferred_from?: string[];
  transferred_to?: string[];
  store?: string;
  product_id?: string;
};

/** The analytics event a webhook delivery owes, if any (store purchases only). */
function captureStoreAnalytics(event: RevenueCatEvent, userId: string, settings: RevenueCatSettings): void {
  const platform = event.store === "PLAY_STORE" ? "android" : "ios";
  const interval = event.product_id && settings.yearlyProductIds.includes(event.product_id) ? "year" : "month";
  if (event.type === "INITIAL_PURCHASE") {
    waitUntilRequest(
      captureServerEvent(userId, "subscription_purchased", { plan: "pro", platform, interval })
    );
  } else if (event.type === "RENEWAL") {
    waitUntilRequest(
      captureServerEvent(userId, "subscription_renewed", { plan: "pro", platform, interval })
    );
  } else if (event.type === "CANCELLATION") {
    waitUntilRequest(captureServerEvent(userId, "subscription_canceled", { plan: "pro", platform }));
  }
}

/** Every app user id an event may concern (a transfer names both sides). */
export function eventAppUserIds(event: RevenueCatEvent): string[] {
  const ids = [
    event.app_user_id,
    event.original_app_user_id,
    ...(event.aliases ?? []),
    ...(event.transferred_from ?? []),
    ...(event.transferred_to ?? []),
  ].filter((id): id is string => typeof id === "string" && id.length > 0 && !isAnonymous(id));
  return [...new Set(ids)];
}

export type WebhookResult = { status: number; body: Record<string, unknown> };

/** Verify and handle one RevenueCat webhook delivery. */
export async function handleRevenueCatWebhook(
  authorization: string | null,
  payload: unknown
): Promise<WebhookResult> {
  const settings = revenueCatSettings();
  if (!settings) return { status: 404, body: { error: "Store billing is not configured." } };
  if (!revenueCatAuthorized(authorization, settings)) {
    return { status: 401, body: { error: "Unauthorized." } };
  }
  const event = (payload as { event?: RevenueCatEvent } | null)?.event;
  if (!event?.id || !event.type) return { status: 400, body: { error: "Missing event." } };

  const outcome = await handleOnce("revenuecat", event.id, event.type, async () => {
    for (const appUserId of eventAppUserIds(event)) {
      if (await syncRevenueCatUser(appUserId, settings)) {
        await attributeBillingEvent("revenuecat", event.id!, appUserId);
        captureStoreAnalytics(event, appUserId, settings);
      }
    }
  });
  return { status: 200, body: { received: true, duplicate: outcome === "duplicate" } };
}

/**
 * Pre-delete hook: remove the account's RevenueCat customer record. This does
 * not cancel a store subscription (only Apple or Google can; the app tells
 * the author to cancel first). Best effort: a failure here never blocks
 * deleting the account.
 */
export async function deleteRevenueCatCustomer(account: { id: string }): Promise<void> {
  const settings = revenueCatSettings();
  if (!settings) return;
  try {
    const res = await fetch(`${settings.apiBase}/v1/subscribers/${encodeURIComponent(account.id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${settings.secretApiKey}` },
    });
    if (!res.ok && res.status !== 404) {
      console.error(`account deletion: RevenueCat customer delete returned ${res.status}`);
    }
  } catch (error) {
    console.error("account deletion: RevenueCat customer delete failed", error);
  }
}
