import Stripe from "stripe";
import { prisma } from "@/lib/db";
import { AuthError, type PublicUser } from "@/lib/auth/session";
import { stripeSettings, type BillingInterval, type StripeSettings } from "@/lib/billing/config";
import { attributeBillingEvent, handleOnce } from "@/lib/billing/events";
import { notifyPaymentFailed, notifySubscriptionCanceled } from "@/lib/billing/notify";
import { activeSubscription, getEntitlement } from "@/lib/entitlements";
import type { DeletingAccount, PreDeleteHook } from "@/lib/account/delete";

// Web billing through Stripe: Checkout for new subscriptions, the Customer
// Portal for everything after, and a webhook that keeps Subscription rows in
// step. Stripe is not behind RevenueCat: its webhooks land here directly.
//
// Workers: "stripe" is a server external package (next.config.mjs), so the
// OpenNext build resolves its `workerd` export. Requests go through fetch and
// webhook signatures are checked with SubtleCrypto (constructEventAsync); the
// synchronous constructEvent needs Node's crypto and is never used.

/** A Stripe client, or null when web billing is not configured. */
export function getStripe(settings: StripeSettings | null = stripeSettings()): Stripe | null {
  if (!settings) return null;
  const config: ConstructorParameters<typeof Stripe>[1] = {
    httpClient: Stripe.createFetchHttpClient(),
    maxNetworkRetries: 2,
    appInfo: { name: "Ciciro" },
  };
  if (settings.apiBase) {
    const base = new URL(settings.apiBase);
    config.host = base.hostname;
    config.port = base.port || (base.protocol === "http:" ? 80 : 443);
    config.protocol = base.protocol === "http:" ? "http" : "https";
  }
  return new Stripe(settings.secretKey, config);
}

function requireStripe(): { stripe: Stripe; settings: StripeSettings } {
  const settings = stripeSettings();
  const stripe = getStripe(settings);
  if (!stripe || !settings) throw new AuthError("Billing is not available.", 404);
  return { stripe, settings };
}

function idOf(ref: string | { id: string } | null | undefined): string | null {
  if (!ref) return null;
  return typeof ref === "string" ? ref : ref.id;
}

/** Statuses that still bill: canceling one of these stops future charges. */
const LIVE_STRIPE_STATUSES = new Set(["active", "trialing", "past_due", "unpaid", "incomplete", "paused"]);

/** Copy one Stripe subscription onto its Subscription row. */
async function upsertStripeSubscription(userId: string, sub: Stripe.Subscription): Promise<void> {
  const item = sub.items.data[0];
  const periodEnds = sub.items.data.map((i) => i.current_period_end).filter((n) => typeof n === "number");
  const currentPeriodEnd = periodEnds.length ? new Date(Math.max(...periodEnds) * 1000) : null;
  const interval = item?.price?.recurring?.interval;
  const data = {
    userId,
    source: "stripe",
    productId: item?.price?.id ?? "",
    plan: "pro",
    interval: interval === "month" || interval === "year" ? interval : "",
    status: sub.status,
    currentPeriodEnd,
    cancelAtPeriodEnd: sub.cancel_at_period_end || sub.cancel_at !== null,
    sandbox: !sub.livemode,
  };
  await prisma.subscription.upsert({
    where: { externalId: sub.id },
    create: { externalId: sub.id, ...data },
    update: data,
  });
}

/**
 * Re-fetch every subscription a Stripe customer has and store them. Webhooks
 * only say "something changed"; reading the current state from Stripe makes
 * the result independent of the order events arrive in.
 */
export async function syncStripeCustomer(stripe: Stripe, customerId: string, userId: string): Promise<void> {
  for await (const sub of stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 })) {
    await upsertStripeSubscription(userId, sub);
  }
}

/** The account a Stripe customer belongs to, linking it on first sight. */
async function accountForCustomer(
  stripe: Stripe,
  customerId: string,
  hintUserId?: string | null
): Promise<{ id: string; email: string; name: string } | null> {
  const select = { id: true, email: true, name: true } as const;
  const linked = await prisma.user.findUnique({ where: { stripeCustomerId: customerId }, select });
  if (linked) return linked;
  let userId = hintUserId ?? null;
  if (!userId) {
    const customer = await stripe.customers.retrieve(customerId);
    if (!customer.deleted) userId = customer.metadata?.userId ?? null;
  }
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { ...select, stripeCustomerId: true } });
  // Never move an account onto a second customer: its first one keeps billing.
  if (!user || (user.stripeCustomerId && user.stripeCustomerId !== customerId)) return null;
  await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: customerId } });
  return { id: user.id, email: user.email, name: user.name };
}

/** Stop every subscription the customer is still billed for, immediately. */
async function cancelLiveSubscriptions(stripe: Stripe, customerId: string): Promise<void> {
  for await (const sub of stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 })) {
    if (LIVE_STRIPE_STATUSES.has(sub.status)) await stripe.subscriptions.cancel(sub.id);
  }
}

/** The customer a handled event is about, and the account hint it carries. */
async function eventCustomer(
  stripe: Stripe,
  event: Stripe.Event
): Promise<{ customerId: string | null; hintUserId?: string | null }> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      return { customerId: idOf(session.customer), hintUserId: session.client_reference_id };
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      return { customerId: idOf(sub.customer), hintUserId: sub.metadata?.userId };
    }
    case "invoice.paid":
    case "invoice.payment_failed":
      return { customerId: idOf(event.data.object.customer) };
    case "charge.refunded":
      return { customerId: idOf(event.data.object.customer) };
    case "charge.dispute.created": {
      const chargeId = idOf(event.data.object.charge);
      if (!chargeId) return { customerId: null };
      const charge = await stripe.charges.retrieve(chargeId);
      return { customerId: idOf(charge.customer) };
    }
    default:
      return { customerId: null };
  }
}

export const HANDLED_STRIPE_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
  "charge.refunded",
  "charge.dispute.created",
] as const;

/** Apply one verified event. Throws to make Stripe retry. */
export async function processStripeEvent(stripe: Stripe, event: Stripe.Event, origin: string): Promise<void> {
  const { customerId, hintUserId } = await eventCustomer(stripe, event);
  if (!customerId) return;
  const user = await accountForCustomer(stripe, customerId, hintUserId);
  // A customer with no Ciciro account (deleted, or made by hand in the
  // dashboard) has nothing to update.
  if (!user) return;
  await attributeBillingEvent("stripe", event.id, user.id);

  // A full refund or a dispute takes the plan away: cancel now, not at period end.
  if (
    (event.type === "charge.refunded" && event.data.object.refunded) ||
    event.type === "charge.dispute.created"
  ) {
    await cancelLiveSubscriptions(stripe, customerId);
  }

  await syncStripeCustomer(stripe, customerId, user.id);

  if (event.type === "invoice.payment_failed") {
    await notifyPaymentFailed(user, { eventId: event.id, manageUrl: `${origin}/pricing` });
  }
  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object;
    await notifySubscriptionCanceled(user, {
      eventId: event.id,
      endedAt: sub.ended_at ? new Date(sub.ended_at * 1000) : null,
      resubscribeUrl: `${origin}/pricing`,
    });
  }
}

export type WebhookResult = { status: number; body: Record<string, unknown> };

/** Verify and handle one Stripe webhook delivery. `payload` is the raw body. */
export async function handleStripeWebhook(
  payload: string,
  signature: string | null,
  origin: string
): Promise<WebhookResult> {
  const settings = stripeSettings();
  const stripe = getStripe(settings);
  if (!stripe || !settings) return { status: 404, body: { error: "Billing is not configured." } };
  if (!signature) return { status: 400, body: { error: "Missing Stripe-Signature." } };

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      payload,
      signature,
      settings.webhookSecret,
      undefined,
      Stripe.createSubtleCryptoProvider()
    );
  } catch {
    return { status: 400, body: { error: "Invalid signature." } };
  }

  if (!(HANDLED_STRIPE_EVENTS as readonly string[]).includes(event.type)) {
    return { status: 200, body: { received: true, ignored: event.type } };
  }
  const outcome = await handleOnce("stripe", event.id, event.type, () =>
    processStripeEvent(stripe, event, origin)
  );
  return { status: 200, body: { received: true, duplicate: outcome === "duplicate" } };
}

/** The account's Stripe customer, created (and saved) on first need. */
async function ensureCustomer(stripe: Stripe, user: PublicUser): Promise<string> {
  const row = await prisma.user.findUnique({ where: { id: user.id }, select: { stripeCustomerId: true } });
  if (row?.stripeCustomerId) return row.stripeCustomerId;
  const customer = await stripe.customers.create(
    { email: user.email, name: user.name || undefined, metadata: { userId: user.id } },
    // Two quick clicks must not make two customers.
    { idempotencyKey: `ciciro-customer-${user.id}` }
  );
  await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: customer.id } });
  return customer.id;
}

export class AlreadySubscribedError extends AuthError {
  constructor(message: string, code: string, manageUrl: string | null) {
    super(message, 409, { error: message, code, manageUrl });
  }
}

/**
 * Refuse a second subscription. The stored entitlement catches a store
 * subscription; a live re-read from Stripe catches a web one whose webhook
 * has not arrived yet.
 */
async function assertNotSubscribed(stripe: Stripe, user: PublicUser, customerId: string | null): Promise<void> {
  if (customerId) await syncStripeCustomer(stripe, customerId, user.id);
  const entitlement = await getEntitlement(user.id);
  if (entitlement.plan === "free") return;
  if (entitlement.source === "stripe") {
    throw new AlreadySubscribedError(
      "You already have Ciciro Pro. Manage it from Settings.",
      "already_subscribed",
      null
    );
  }
  const store = entitlement.source === "app_store" ? "the App Store" : "Google Play";
  throw new AlreadySubscribedError(
    `You subscribe to Ciciro Pro through ${store}. Manage or cancel it there.`,
    "store_subscription_active",
    entitlement.manageUrl
  );
}

export type TaxMode = "managed_payments" | "automatic_tax" | "none";

function taxMode(): TaxMode {
  const raw = (process.env["STRIPE_TAX_MODE"] ?? "").trim();
  return raw === "automatic_tax" || raw === "none" ? raw : "managed_payments";
}

/** Start web Checkout for Ciciro Pro. Returns the hosted Checkout URL. */
export async function createCheckoutSession(
  user: PublicUser,
  interval: BillingInterval,
  origin: string
): Promise<string> {
  const { stripe, settings } = requireStripe();
  const existing = await prisma.user.findUnique({ where: { id: user.id }, select: { stripeCustomerId: true } });
  await assertNotSubscribed(stripe, user, existing?.stripeCustomerId ?? null);
  const customer = await ensureCustomer(stripe, user);

  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    customer,
    client_reference_id: user.id,
    line_items: [{ price: settings.prices[interval], quantity: 1 }],
    subscription_data: { metadata: { userId: user.id } },
    allow_promotion_codes: true,
    success_url: `${origin}/pricing?checkout=success`,
    cancel_url: `${origin}/pricing`,
  };
  const mode = taxMode();
  if (mode === "managed_payments") params.managed_payments = { enabled: true };
  if (mode === "automatic_tax") {
    params.automatic_tax = { enabled: true };
    params.customer_update = { address: "auto", name: "auto" };
  }
  const session = await stripe.checkout.sessions.create(params);
  if (!session.url) throw new AuthError("Stripe did not return a Checkout page.", 502);
  return session.url;
}

/** Open the Stripe Customer Portal (change plan, card, cancel, invoices). */
export async function createPortalSession(user: PublicUser, origin: string): Promise<string> {
  const { stripe } = requireStripe();
  const row = await prisma.user.findUnique({ where: { id: user.id }, select: { stripeCustomerId: true } });
  if (!row?.stripeCustomerId) throw new AuthError("There is no web subscription to manage.", 404);
  const session = await stripe.billingPortal.sessions.create({
    customer: row.stripeCustomerId,
    return_url: `${origin}/pricing`,
  });
  return session.url;
}

/**
 * Pre-delete hook: stop Stripe billing before the account goes, so a deleted
 * account is never charged again. Throws (aborting the deletion, account
 * intact) when it cannot be sure, including when the account has a Stripe
 * customer but this server no longer has Stripe keys.
 */
export async function cancelStripeBilling(account: DeletingAccount): Promise<void> {
  const row = await prisma.user.findUnique({ where: { id: account.id }, select: { stripeCustomerId: true } });
  if (!row?.stripeCustomerId) return;
  const stripe = getStripe();
  if (!stripe) {
    const subs = await prisma.subscription.findMany({ where: { userId: account.id, source: "stripe" } });
    if (activeSubscription(subs)) throw new Error("Stripe is not configured; cannot cancel the subscription.");
    return;
  }
  await cancelLiveSubscriptions(stripe, row.stripeCustomerId);
}

export const STRIPE_PRE_DELETE_HOOK: PreDeleteHook = {
  name: "stripe-cancel-subscription",
  run: cancelStripeBilling,
};
