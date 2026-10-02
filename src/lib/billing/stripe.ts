import Stripe from "stripe";
import { prisma } from "@/lib/db";
import { AuthError, type PublicUser } from "@/lib/auth/session";
import { openEarlyAccess, stripeSettings, type BillingInterval, type StripeSettings } from "@/lib/billing/config";
import { attributeBillingEvent, handleOnce } from "@/lib/billing/events";
import { formatPrice } from "@/lib/billing/prices";
import { activeSubscription, getEntitlement } from "@/lib/entitlements";
import {
  sendPaymentFailedEmail,
  sendRenewalReminderEmail,
  sendSubscriptionCanceledEmail,
  type BillingEmailRecipient,
} from "@/lib/email/account-emails";
import type { DeletingAccount, PreDeleteHook } from "@/lib/account/delete";
import { captureServerEvent } from "@/lib/analytics-server";
import { waitUntilRequest } from "@/lib/db";

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

/** Marks a cancellation Ciciro made because the account is being deleted. */
const ACCOUNT_DELETED = "account_deleted";
/** Marks the cancellation Ciciro makes when a full refund reverses a payment. */
const CHARGE_REFUNDED = "charge_refunded";
/** Marks the cancellation Ciciro makes when a charge is disputed. */
const CHARGE_DISPUTED = "charge_disputed";
const CICIRO_CANCEL_COMMENTS = new Set([ACCOUNT_DELETED, CHARGE_REFUNDED, CHARGE_DISPUTED]);

function fromUnix(seconds: number | null | undefined): Date | null {
  return typeof seconds === "number" ? new Date(seconds * 1000) : null;
}

/** The end of the period paid for: the latest of the items' period ends. */
function periodEnd(sub: Pick<Stripe.Subscription, "items">): Date | null {
  const ends = sub.items.data.map((i) => i.current_period_end).filter((n) => typeof n === "number");
  return ends.length ? new Date(Math.max(...ends) * 1000) : null;
}

/** The billing interval a subscription's price recurs on, if a known one. */
function planInterval(sub: Stripe.Subscription): "month" | "year" | undefined {
  const interval: string | undefined = sub.items.data[0]?.price?.recurring?.interval;
  if (interval === "month" || interval === "year") return interval;
  return undefined;
}

/** Copy one Stripe subscription onto its Subscription row. */
async function upsertStripeSubscription(userId: string, sub: Stripe.Subscription): Promise<void> {
  const item = sub.items.data[0];
  const currentPeriodEnd = periodEnd(sub);
  const data = {
    userId,
    source: "stripe",
    productId: item?.price?.id ?? "",
    plan: "pro",
    interval: planInterval(sub) ?? "",
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

/**
 * Stop every subscription the customer is still billed for, immediately.
 * `comment` lands on the subscription's cancellation_details, where the
 * webhook reads it back.
 */
async function cancelLiveSubscriptions(stripe: Stripe, customerId: string, comment?: string): Promise<void> {
  for await (const sub of stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 })) {
    if (!LIVE_STRIPE_STATUSES.has(sub.status)) continue;
    await stripe.subscriptions.cancel(sub.id, comment ? { cancellation_details: { comment } } : undefined);
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
    case "invoice.upcoming":
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
  "invoice.upcoming",
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
  if (event.type === "charge.refunded" && event.data.object.refunded) {
    await cancelLiveSubscriptions(stripe, customerId, CHARGE_REFUNDED);
  } else if (event.type === "charge.dispute.created") {
    await cancelLiveSubscriptions(stripe, customerId, CHARGE_DISPUTED);
  }

  await syncStripeCustomer(stripe, customerId, user.id);
  await captureBillingAnalytics(event, user.id);
  // The event is applied; an email that cannot be built must not make Stripe
  // redeliver it.
  await sendBillingEmail(event, user, origin).catch((error) =>
    console.error(`[billing] no email for ${event.type} ${event.id}`, error)
  );
}

/** When a scheduled cancellation takes effect, or null when none is scheduled. */
function scheduledEnd(sub: Pick<Stripe.Subscription, "cancel_at" | "cancel_at_period_end" | "items">): Date | null {
  if (sub.cancel_at) return fromUnix(sub.cancel_at);
  return sub.cancel_at_period_end ? periodEnd(sub) : null;
}

/**
 * The moment a cancellation is newly scheduled by this update - not one
 * already scheduled before it (a later, unrelated change to the same
 * subscription) and not one just undone. Null unless this update is that
 * moment. Shared by the cancellation email and the subscription_canceled
 * analytics event, which both fire at this same moment (auto-renew just
 * turned off; Pro still runs until endsAt) - see docs/analytics.md.
 */
function newlyScheduledCancellation(event: Stripe.Event): Date | null {
  if (event.type !== "customer.subscription.updated") return null;
  const sub = event.data.object;
  const endsAt = scheduledEnd(sub);
  if (!endsAt || !LIVE_STRIPE_STATUSES.has(sub.status)) return null;
  const previous = event.data.previous_attributes ?? {};
  const before = {
    cancel_at: "cancel_at" in previous ? (previous.cancel_at ?? null) : sub.cancel_at,
    cancel_at_period_end:
      "cancel_at_period_end" in previous ? Boolean(previous.cancel_at_period_end) : sub.cancel_at_period_end,
    items: sub.items,
  };
  return scheduledEnd(before) ? null : endsAt;
}

/**
 * The analytics event a webhook delivery owes, if any. Runs after the sync,
 * same as the email: only a change Ciciro actually applied gets counted.
 * Web billing only - RevenueCat's own webhook covers store purchases.
 */
async function captureBillingAnalytics(event: Stripe.Event, userId: string): Promise<void> {
  if (event.type === "customer.subscription.created") {
    const sub = event.data.object;
    waitUntilRequest(
      captureServerEvent(userId, "subscription_purchased", {
        plan: "pro",
        platform: "web",
        interval: planInterval(sub),
      })
    );
    return;
  }
  if (event.type === "invoice.paid" && event.data.object.billing_reason === "subscription_cycle") {
    const subscriptionId = idOf(event.data.object.parent?.subscription_details?.subscription);
    const row = subscriptionId
      ? await prisma.subscription.findUnique({ where: { externalId: subscriptionId } })
      : null;
    waitUntilRequest(
      captureServerEvent(userId, "subscription_renewed", {
        plan: "pro",
        platform: "web",
        interval: row?.interval === "month" || row?.interval === "year" ? row.interval : undefined,
      })
    );
    return;
  }
  // "Canceled" is the moment auto-renew turns off, Pro still active until
  // the period ends - matching RevenueCat's CANCELLATION.
  if (event.type === "customer.subscription.updated") {
    if (!newlyScheduledCancellation(event)) return;
    waitUntilRequest(captureServerEvent(userId, "subscription_canceled", { plan: "pro", platform: "web" }));
    return;
  }
  // "Ended" is access actually gone now - matching RevenueCat's EXPIRATION.
  if (event.type === "customer.subscription.deleted") {
    waitUntilRequest(captureServerEvent(userId, "subscription_ended", { plan: "pro", platform: "web" }));
  }
}

/**
 * The email an event owes the subscriber, if any. Runs after the sync, so a
 * failed sync (which Stripe retries) never leaves an email sent for an event
 * that was not applied. Every link goes to the pricing page, whose Manage
 * billing opens the Customer Portal.
 */
async function sendBillingEmail(event: Stripe.Event, user: BillingEmailRecipient, origin: string): Promise<void> {
  const pricingUrl = `${origin}/pricing`;
  switch (event.type) {
    case "invoice.payment_failed": {
      const invoice = event.data.object;
      await sendPaymentFailedEmail(user, {
        eventId: event.id,
        amount: formatPrice(invoice.amount_due, invoice.currency),
        attemptedAt: fromUnix(event.created)!,
        nextAttemptAt: fromUnix(invoice.next_payment_attempt),
        updatePaymentUrl: pricingUrl,
      });
      return;
    }
    case "customer.subscription.updated": {
      // Scheduling a cancellation (the portal's Cancel) is when the author
      // cancels, so that is when they hear about it, with the date Pro ends.
      const endsAt = newlyScheduledCancellation(event);
      if (!endsAt) return;
      await sendSubscriptionCanceledEmail(user, { eventId: event.id, endsAt, resubscribeUrl: pricingUrl });
      return;
    }
    case "customer.subscription.deleted": {
      // A scheduled cancellation was announced when it was scheduled. A
      // cancel Ciciro made itself (a refund, a dispute, account deletion) is
      // not the author's choice, so "you keep it until today" would read
      // wrong; an account being deleted gets the account-deleted email. A
      // cancel from the portal or dashboard, or retries running out, is
      // emailed.
      const sub = event.data.object;
      const comment = sub.cancellation_details?.comment;
      if (scheduledEnd(sub) || (comment && CICIRO_CANCEL_COMMENTS.has(comment))) return;
      await sendSubscriptionCanceledEmail(user, {
        eventId: event.id,
        endsAt: fromUnix(sub.ended_at) ?? fromUnix(event.created)!,
        resubscribeUrl: pricingUrl,
      });
      return;
    }
    case "invoice.upcoming": {
      // Yearly renewals only: a year is long enough to forget a subscription,
      // and card-network rules expect notice before a long-term renewal. A
      // monthly reminder would arrive every month.
      const invoice = event.data.object;
      const subscriptionId = idOf(invoice.parent?.subscription_details?.subscription);
      if (!subscriptionId) return;
      const row = await prisma.subscription.findUnique({ where: { externalId: subscriptionId } });
      if (!row || row.userId !== user.id || row.interval !== "year" || row.status !== "active") return;
      if (row.cancelAtPeriodEnd || !row.currentPeriodEnd) return;
      await sendRenewalReminderEmail(user, {
        eventId: event.id,
        amount: formatPrice(invoice.amount_due, invoice.currency),
        renewsAt: row.currentPeriodEnd,
        manageUrl: pricingUrl,
      });
      return;
    }
    default:
      return;
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

/**
 * Whether Checkout applies the early-access coupon for this account: the offer
 * is open and the account has never had Pro from any source, as the stores'
 * introductory offers work. Call after `assertNotSubscribed`, which re-reads
 * the account's Stripe subscriptions first.
 */
export async function earlyAccessApplies(userId: string, now: Date = new Date()): Promise<string | null> {
  const offer = openEarlyAccess(now);
  if (!offer) return null;
  const before = await prisma.subscription.count({ where: { userId } });
  return before === 0 ? offer.couponId : null;
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

  const coupon = await earlyAccessApplies(user.id);

  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    customer,
    client_reference_id: user.id,
    line_items: [{ price: settings.prices[interval], quantity: 1 }],
    subscription_data: { metadata: { userId: user.id } },
    success_url: `${origin}/pricing?checkout=success`,
    cancel_url: `${origin}/pricing`,
  };
  // Stripe takes either a set discount or a promotion code box, not both.
  if (coupon) params.discounts = [{ coupon }];
  else params.allow_promotion_codes = true;
  const mode = taxMode();
  if (mode === "managed_payments") params.managed_payments = { enabled: true };
  if (mode === "automatic_tax") {
    params.automatic_tax = { enabled: true };
    params.customer_update = { address: "auto", name: "auto" };
  }
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create(params);
  } catch (error) {
    // A deleted or expired coupon must not stop someone paying full price.
    if (!coupon || !(error instanceof Stripe.errors.StripeInvalidRequestError)) throw error;
    console.error("[billing] early-access coupon rejected; Checkout without it", error);
    delete params.discounts;
    params.allow_promotion_codes = true;
    session = await stripe.checkout.sessions.create(params);
  }
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
  await cancelLiveSubscriptions(stripe, row.stripeCustomerId, ACCOUNT_DELETED);
}

export const STRIPE_PRE_DELETE_HOOK: PreDeleteHook = {
  name: "stripe-cancel-subscription",
  run: cancelStripeBilling,
};
