import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { SESSION_HEADER } from "@/lib/auth/constants";
import { hashSessionToken } from "@/lib/auth/tokens";
import { hashPassword } from "@/lib/auth/password";
import { getEntitlement } from "@/lib/entitlements";
import * as accountEmails from "@/lib/email/account-emails";
import * as email from "@/lib/email";
import * as analyticsServer from "@/lib/analytics-server";
import { formatEmailDate } from "@/lib/email/templates";
import { cancelStripeBilling, getStripe } from "@/lib/billing/stripe";
import { openEarlyAccess, stripeSettings } from "@/lib/billing/config";
import { earlyAccessOffer, proPrices } from "@/lib/billing/prices";
import { POST as webhook } from "@/app/api/billing/webhooks/stripe/route";
import { POST as checkout } from "@/app/api/billing/checkout/route";
import { POST as portal } from "@/app/api/billing/portal/route";
import { DELETE as deleteAccountRoute } from "@/app/api/auth/account/route";
import { middleware } from "@/middleware";
import { wipeDatabase } from "./account-fixture";
import { fakeStripe, saveBillingEnv, useFakeStripe, type FakeStripe } from "./helpers/fake-billing";

type Account = { id: string; email: string; token: string; password: string };

async function account(label: string): Promise<Account> {
  const password = `${label}-password`;
  const user = await prisma.user.create({
    data: { email: `${label}@example.com`, name: label, passwordHash: await hashPassword(password) },
  });
  const token = `${label}-token`;
  await prisma.session.create({
    data: { userId: user.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3_600_000) },
  });
  return { id: user.id, email: user.email, token, password };
}

function post(path: string, token: string | null, body: unknown, method = "POST") {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { [SESSION_HEADER]: token } : {}) },
    body: JSON.stringify(body),
  });
}

async function deliver(fake: FakeStripe, event: Record<string, unknown>, signature?: string) {
  const signed = await fake.sign(event);
  const res = await webhook(
    new NextRequest("http://localhost/api/billing/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": signature ?? signed.signature },
      body: signed.payload,
    })
  );
  return { status: res.status, body: await res.json() };
}

/** An account already paying through Stripe, as the webhook would leave it. */
async function subscribed(fake: FakeStripe, label: string, interval: "month" | "year" = "month") {
  const user = await account(label);
  const customer = fake.addCustomer(user.id);
  await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: customer } });
  const sub = fake.addSubscription(customer, { userId: user.id, interval });
  await deliver(fake, fake.event("customer.subscription.created", sub));
  return { user, customer, sub };
}

/** A Stripe invoice as its events carry it. */
function invoice(customer: string, extra: Record<string, unknown> = {}) {
  return { object: "invoice", customer, amount_due: 1200, currency: "usd", next_payment_attempt: null, ...extra };
}

type Sent = { to: string; category: string | undefined; subject: string; text: string; idempotencyKey?: string };

/** Capture what the billing emails hand to Resend, without sending. */
function captureEmails(): () => Sent[] {
  const spy = vi.spyOn(email, "sendEmail").mockResolvedValue({ sent: true });
  return () =>
    spy.mock.calls.map(([options]) => ({
      to: options.to as string,
      category: options.tags?.find((t) => t.name === "category")?.value,
      subject: options.subject,
      text: options.text,
      idempotencyKey: options.idempotencyKey,
    }));
}

type Captured = { userId: string; event: string; properties: Record<string, unknown> };

/** Capture the analytics events a webhook hands off, without sending them. */
function captureAnalytics(): () => Captured[] {
  const spy = vi.spyOn(analyticsServer, "captureServerEvent").mockResolvedValue(undefined);
  return () =>
    spy.mock.calls.map(([userId, event, properties]) => ({
      userId,
      event,
      properties: properties as Record<string, unknown>,
    }));
}

describe("Stripe billing", () => {
  let fake: FakeStripe;
  let restoreEnv: () => void;

  beforeAll(async () => {
    fake = await fakeStripe();
  });
  afterAll(async () => {
    await fake.close();
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    restoreEnv = saveBillingEnv();
    process.env.CICIRO_REQUIRE_AUTH = "true";
    useFakeStripe(fake);
    await wipeDatabase();
    fake.requests.length = 0;
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => restoreEnv());

  describe("webhook", () => {
    it("lets the webhook past the session gate", () => {
      const res = middleware(new NextRequest("http://localhost/api/billing/webhooks/stripe", { method: "POST" }));
      expect(res.status).toBe(200);
      expect(res.headers.get("x-middleware-next")).toBe("1");
    });

    it("rejects a delivery with no signature or a forged one", async () => {
      const event = fake.event("invoice.paid", { customer: "cus_x" });
      const forged = await deliver(fake, event, "t=1,v1=deadbeef");
      expect(forged.status).toBe(400);
      const unsigned = await webhook(
        new NextRequest("http://localhost/api/billing/webhooks/stripe", { method: "POST", body: "{}" })
      );
      expect(unsigned.status).toBe(400);
      expect(await prisma.billingEvent.count()).toBe(0);
    });

    it("answers 404 and changes nothing when Stripe is not configured", async () => {
      delete process.env.STRIPE_SECRET_KEY;
      const { status } = await deliver(fake, fake.event("invoice.paid", { customer: "cus_x" }));
      expect(status).toBe(404);
    });

    it("turns Pro on from checkout.session.completed by re-reading the subscription", async () => {
      const user = await account("buyer");
      const customer = fake.addCustomer(user.id);
      fake.addSubscription(customer, { interval: "year" });
      const { status } = await deliver(
        fake,
        fake.event("checkout.session.completed", { object: "checkout.session", customer, client_reference_id: user.id })
      );
      expect(status).toBe(200);
      const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(stored.stripeCustomerId).toBe(customer);
      const entitlement = await getEntitlement(user.id);
      expect(entitlement).toMatchObject({ plan: "pro", source: "stripe", interval: "year", status: "active" });
      const events = await prisma.billingEvent.findMany();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ source: "stripe", type: "checkout.session.completed", userId: user.id });
    });

    it("handles a redelivered event once", async () => {
      const { user, customer } = await subscribed(fake, "twice");
      const failed = vi.spyOn(accountEmails, "sendPaymentFailedEmail");
      const event = fake.event("invoice.payment_failed", invoice(customer));
      const first = await deliver(fake, event);
      const second = await deliver(fake, event);
      expect(first.body).toEqual({ received: true, duplicate: false });
      expect(second.body).toEqual({ received: true, duplicate: true });
      expect(failed).toHaveBeenCalledTimes(1);
      expect(failed.mock.calls[0][0]).toMatchObject({ id: user.id });
      expect(await prisma.billingEvent.count({ where: { eventId: event.id as string } })).toBe(1);
    });

    it("follows Stripe's current state whatever order events arrive in", async () => {
      const { user, sub } = await subscribed(fake, "order");
      // The subscription is canceled in Stripe; a stale "updated" (status
      // active in its payload) arrives after the "deleted".
      const live = fake.subscriptions.get(sub.id)!;
      live.status = "canceled";
      const canceled = vi.spyOn(accountEmails, "sendSubscriptionCanceledEmail");
      await deliver(fake, fake.event("customer.subscription.deleted", { ...live }));
      await deliver(fake, fake.event("customer.subscription.updated", { ...live, status: "active" }));
      expect((await getEntitlement(user.id)).plan).toBe("free");
      expect(canceled).toHaveBeenCalledTimes(1);
    });

    it("keeps Pro through a failed payment while Stripe retries (past_due)", async () => {
      const { user, sub } = await subscribed(fake, "pastdue");
      fake.subscriptions.get(sub.id)!.status = "past_due";
      await deliver(fake, fake.event("invoice.payment_failed", invoice(sub.customer)));
      expect(await getEntitlement(user.id)).toMatchObject({ plan: "pro", status: "past_due" });
    });

    it("records cancel-at-period-end without taking Pro away", async () => {
      const { user, sub } = await subscribed(fake, "cancelling");
      fake.subscriptions.get(sub.id)!.cancel_at_period_end = true;
      await deliver(fake, fake.event("customer.subscription.updated", fake.subscriptions.get(sub.id)));
      expect(await getEntitlement(user.id)).toMatchObject({ plan: "pro", cancelAtPeriodEnd: true });
    });

    it("revokes Pro on a full refund but not a partial one", async () => {
      const { user, customer, sub } = await subscribed(fake, "refund");
      fake.charges.set("ch_partial", { id: "ch_partial", object: "charge", customer, refunded: false });
      await deliver(fake, fake.event("charge.refunded", fake.charges.get("ch_partial")));
      expect((await getEntitlement(user.id)).plan).toBe("pro");

      await deliver(fake, fake.event("charge.refunded", { id: "ch_full", object: "charge", customer, refunded: true }));
      expect(fake.subscriptions.get(sub.id)!.status).toBe("canceled");
      expect((await getEntitlement(user.id)).plan).toBe("free");
    });

    it("revokes Pro when a charge is disputed", async () => {
      const { user, customer, sub } = await subscribed(fake, "dispute");
      fake.charges.set("ch_disputed", { id: "ch_disputed", object: "charge", customer, refunded: false });
      await deliver(fake, fake.event("charge.dispute.created", { id: "dp_1", object: "dispute", charge: "ch_disputed" }));
      expect(fake.subscriptions.get(sub.id)!.status).toBe("canceled");
      expect((await getEntitlement(user.id)).plan).toBe("free");
    });

    it("asks Stripe to retry when handling fails, and handles the retry", async () => {
      const user = await account("retry");
      const customer = fake.addCustomer(user.id);
      await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: customer } });
      fake.addSubscription(customer);
      const event = fake.event("invoice.paid", { object: "invoice", customer });
      fake.failNext("/v1/subscriptions", 3);
      vi.spyOn(console, "error").mockImplementation(() => {});
      expect((await deliver(fake, event)).status).toBe(500);
      expect(await prisma.billingEvent.count()).toBe(0);
      expect((await deliver(fake, event)).body).toEqual({ received: true, duplicate: false });
      expect((await getEntitlement(user.id)).plan).toBe("pro");
    });

    it("ignores events it does not handle and customers with no account", async () => {
      const ignored = await deliver(fake, fake.event("customer.created", { id: "cus_1" }));
      expect(ignored.body).toMatchObject({ received: true, ignored: "customer.created" });
      const stranger = fake.addCustomer("no-such-user");
      const unknown = await deliver(fake, fake.event("invoice.paid", { object: "invoice", customer: stranger }));
      expect(unknown.status).toBe(200);
      expect(await prisma.subscription.count()).toBe(0);
    });
  });

  describe("emails", () => {
    const DAY = 86_400;

    it("tells the author a payment failed, with the amount and the next try, once", async () => {
      const { user, customer } = await subscribed(fake, "declined");
      const sent = captureEmails();
      const nextTry = Math.floor(Date.now() / 1000) + 3 * DAY;
      const event = fake.event("invoice.payment_failed", invoice(customer, { next_payment_attempt: nextTry }));
      await deliver(fake, event);
      await deliver(fake, event);

      expect(sent()).toHaveLength(1);
      const [mail] = sent();
      expect(mail).toMatchObject({ to: user.email, category: "payment_failed", idempotencyKey: `billing/${event.id}` });
      expect(mail.text).toContain("$12");
      expect(mail.text).toContain(formatEmailDate(new Date(nextTry * 1000)));
      expect(mail.text).toContain("http://localhost/pricing");
    });

    it("announces a scheduled cancellation when it is made, and not again when it takes effect", async () => {
      const { user, sub } = await subscribed(fake, "leaving");
      const sent = captureEmails();
      const live = fake.subscriptions.get(sub.id)!;
      const endsAt = live.items.data[0].current_period_end;
      live.cancel_at_period_end = true;
      live.cancel_at = endsAt;
      const scheduled = { cancel_at_period_end: false, cancel_at: null };
      await deliver(fake, fake.event("customer.subscription.updated", { ...live }, scheduled));
      // A later change (a new card, say) to the still-cancelling subscription.
      await deliver(fake, fake.event("customer.subscription.updated", { ...live }, { default_payment_method: null }));
      live.status = "canceled";
      live.ended_at = endsAt;
      await deliver(fake, fake.event("customer.subscription.deleted", { ...live }));

      expect(sent().map((m) => m.category)).toEqual(["subscription_canceled"]);
      expect(sent()[0].to).toBe(user.email);
      expect(sent()[0].text).toContain(formatEmailDate(new Date(endsAt * 1000)));
    });

    it("sends nothing when a scheduled cancellation is undone", async () => {
      const { sub } = await subscribed(fake, "stays");
      const sent = captureEmails();
      const live = fake.subscriptions.get(sub.id)!;
      const undone = { cancel_at_period_end: true, cancel_at: 1 };
      await deliver(fake, fake.event("customer.subscription.updated", { ...live }, undone));
      expect(sent()).toHaveLength(0);
    });

    it("sends no cancellation email for a subscription Ciciro ended over a full refund", async () => {
      const { customer, sub } = await subscribed(fake, "refunded");
      const sent = captureEmails();
      await deliver(fake, fake.event("charge.refunded", { id: "ch_all", object: "charge", customer, refunded: true }));
      const ended = fake.subscriptions.get(sub.id)!;
      expect(ended.cancellation_details.comment).toBe("charge_refunded");
      await deliver(fake, fake.event("customer.subscription.deleted", { ...ended }));
      expect(sent()).toHaveLength(0);
    });

    it("sends no cancellation email for a subscription Ciciro ended over a dispute", async () => {
      const { customer, sub } = await subscribed(fake, "disputed");
      const sent = captureEmails();
      fake.charges.set("ch_dis", { id: "ch_dis", object: "charge", customer, refunded: false });
      await deliver(fake, fake.event("charge.dispute.created", { id: "dp_2", object: "dispute", charge: "ch_dis" }));
      const ended = fake.subscriptions.get(sub.id)!;
      expect(ended.cancellation_details.comment).toBe("charge_disputed");
      await deliver(fake, fake.event("customer.subscription.deleted", { ...ended }));
      expect(sent()).toHaveLength(0);
    });

    it("tells the author when they cancel a subscription and it ends at once", async () => {
      const { user, sub } = await subscribed(fake, "immediate");
      const sent = captureEmails();
      const live = fake.subscriptions.get(sub.id)!;
      live.status = "canceled";
      await deliver(fake, fake.event("customer.subscription.deleted", { ...live }));

      expect(sent()).toHaveLength(1);
      expect(sent()[0]).toMatchObject({ to: user.email, category: "subscription_canceled" });
      expect(sent()[0].text).toContain(formatEmailDate(new Date()));
    });

    it("tells the author when retries run out and the subscription ends", async () => {
      const { user, sub } = await subscribed(fake, "dunned");
      const sent = captureEmails();
      const live = fake.subscriptions.get(sub.id)!;
      live.status = "canceled";
      const details = { reason: "payment_failed", comment: null };
      await deliver(fake, fake.event("customer.subscription.deleted", { ...live, cancellation_details: details }));

      expect(sent()).toHaveLength(1);
      expect(sent()[0]).toMatchObject({ to: user.email, category: "subscription_canceled" });
    });

    it("sends no cancellation email for a subscription ended by deleting the account", async () => {
      const { user, sub } = await subscribed(fake, "deleting");
      const sent = captureEmails();
      await cancelStripeBilling({ id: user.id, email: user.email } as Parameters<typeof cancelStripeBilling>[0]);
      const ended = fake.subscriptions.get(sub.id)!;
      expect(ended.cancellation_details.comment).toBe("account_deleted");
      await deliver(fake, fake.event("customer.subscription.deleted", { ...ended }));
      expect(sent()).toHaveLength(0);
    });

    it("reminds a yearly subscriber of the renewal, and no one else", async () => {
      const yearly = await subscribed(fake, "yearly", "year");
      const monthly = await subscribed(fake, "monthly", "month");
      const cancelling = await subscribed(fake, "lapsing", "year");
      const live = fake.subscriptions.get(cancelling.sub.id)!;
      live.cancel_at_period_end = true;
      await deliver(fake, fake.event("customer.subscription.updated", { ...live }));
      const sent = captureEmails();

      const upcoming = (s: { customer: string; sub: { id: string } }) =>
        fake.event(
          "invoice.upcoming",
          invoice(s.customer, { amount_due: 9600, parent: { subscription_details: { subscription: s.sub.id } } })
        );
      const reminder = upcoming(yearly);
      await deliver(fake, reminder);
      await deliver(fake, upcoming(monthly));
      await deliver(fake, upcoming(cancelling));

      expect(sent()).toHaveLength(1);
      const [mail] = sent();
      expect(mail).toMatchObject({
        to: yearly.user.email,
        category: "renewal_reminder",
        idempotencyKey: `billing/${reminder.id}`,
      });
      expect(mail.text).toContain("$96");
      const renewsAt = new Date(fake.subscriptions.get(yearly.sub.id)!.items.data[0].current_period_end * 1000);
      expect(mail.subject).toContain(formatEmailDate(renewsAt));
    });

    it("never fails the webhook over an email", async () => {
      const { user, customer } = await subscribed(fake, "badmail");
      captureEmails();
      vi.spyOn(console, "error").mockImplementation(() => {});
      const broken = invoice(customer, { currency: "not a currency" });
      const { status, body } = await deliver(fake, fake.event("invoice.payment_failed", broken));
      expect(status).toBe(200);
      expect(body).toEqual({ received: true, duplicate: false });
      expect((await getEntitlement(user.id)).plan).toBe("pro");
    });
  });

  describe("analytics", () => {
    it("fires subscription_canceled the moment a cancellation is scheduled, and not again for an unrelated update", async () => {
      const { user, sub } = await subscribed(fake, "cancel-analytics");
      const captured = captureAnalytics();
      const live = fake.subscriptions.get(sub.id)!;
      const endsAt = live.items.data[0].current_period_end;
      live.cancel_at_period_end = true;
      live.cancel_at = endsAt;
      const scheduled = { cancel_at_period_end: false, cancel_at: null };
      await deliver(fake, fake.event("customer.subscription.updated", { ...live }, scheduled));
      // A later, unrelated change to the still-cancelling subscription.
      await deliver(fake, fake.event("customer.subscription.updated", { ...live }, { default_payment_method: null }));

      expect(captured()).toEqual([
        { userId: user.id, event: "subscription_canceled", properties: { plan: "pro", platform: "web" } },
      ]);
    });

    it("fires nothing when a scheduled cancellation is undone", async () => {
      const { sub } = await subscribed(fake, "stays-analytics");
      const captured = captureAnalytics();
      const live = fake.subscriptions.get(sub.id)!;
      const undone = { cancel_at_period_end: true, cancel_at: 1 };
      await deliver(fake, fake.event("customer.subscription.updated", { ...live }, undone));
      expect(captured()).toEqual([]);
    });

    it("fires subscription_ended, not subscription_canceled, when the subscription actually ends", async () => {
      const { user, sub } = await subscribed(fake, "ended-analytics");
      const captured = captureAnalytics();
      const live = fake.subscriptions.get(sub.id)!;
      live.status = "canceled";
      await deliver(fake, fake.event("customer.subscription.deleted", { ...live }));

      expect(captured()).toEqual([
        { userId: user.id, event: "subscription_ended", properties: { plan: "pro", platform: "web" } },
      ]);
    });
  });

  describe("Checkout", () => {
    it("creates the customer once and starts a subscription Checkout for the account", async () => {
      const user = await account("checkout");
      const res = await checkout(post("/api/billing/checkout", user.token, { interval: "year" }));
      expect(res.status).toBe(200);
      expect((await res.json()).url).toMatch(/^https:\/\/checkout\.stripe\.test\//);

      const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(stored.stripeCustomerId).toMatch(/^cus_/);
      expect(fake.customers.get(stored.stripeCustomerId!)?.metadata).toEqual({ userId: user.id });
      const session = fake.requests.find((r) => r.path === "/v1/checkout/sessions")!;
      expect(session.params).toMatchObject({
        mode: "subscription",
        customer: stored.stripeCustomerId,
        client_reference_id: user.id,
        "line_items[0][price]": "price_pro_year",
        "managed_payments[enabled]": "true",
        "subscription_data[metadata][userId]": user.id,
      });

      await checkout(post("/api/billing/checkout", user.token, { interval: "month" }));
      expect(fake.requests.filter((r) => r.path === "/v1/customers")).toHaveLength(1);
    });

    it("uses Stripe Tax instead of Managed Payments when configured", async () => {
      process.env.STRIPE_TAX_MODE = "automatic_tax";
      const user = await account("tax");
      await checkout(post("/api/billing/checkout", user.token, { interval: "month" }));
      const session = fake.requests.find((r) => r.path === "/v1/checkout/sessions")!;
      expect(session.params["automatic_tax[enabled]"]).toBe("true");
      expect(session.params["managed_payments[enabled]"]).toBeUndefined();
    });

    it("refuses a second web subscription, even before its webhook lands", async () => {
      const user = await account("again");
      const customer = fake.addCustomer(user.id);
      await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: customer } });
      fake.addSubscription(customer);
      const res = await checkout(post("/api/billing/checkout", user.token, { interval: "month" }));
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: "already_subscribed" });
      expect(fake.requests.some((r) => r.path === "/v1/checkout/sessions")).toBe(false);
    });

    it("refuses web Checkout while a store subscription is active", async () => {
      const user = await account("store");
      await prisma.subscription.create({
        data: {
          userId: user.id,
          source: "app_store",
          externalId: `revenuecat:${user.id}:ciciro_pro_monthly`,
          productId: "ciciro_pro_monthly",
          status: "active",
          currentPeriodEnd: new Date(Date.now() + 86_400_000),
        },
      });
      const res = await checkout(post("/api/billing/checkout", user.token, { interval: "month" }));
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        error: "You subscribe to Ciciro Pro through the App Store. Manage or cancel it there.",
        code: "store_subscription_active",
        manageUrl: "https://apps.apple.com/account/subscriptions",
      });
      expect(fake.requests.some((r) => r.path.startsWith("/v1/checkout"))).toBe(false);
    });

    it("needs a session, a valid interval, and Stripe configured", async () => {
      expect((await checkout(post("/api/billing/checkout", null, { interval: "month" }))).status).toBe(401);
      const user = await account("bad");
      expect((await checkout(post("/api/billing/checkout", user.token, { interval: "week" }))).status).toBe(400);
      delete process.env.STRIPE_PRICE_PRO_YEARLY;
      expect((await checkout(post("/api/billing/checkout", user.token, { interval: "month" }))).status).toBe(404);
    });
  });

  describe("the early-access offer", () => {
    const sessionParams = () => fake.requests.find((r) => r.path === "/v1/checkout/sessions")!.params;

    beforeEach(() => {
      process.env.STRIPE_EARLY_ACCESS_COUPON = "early_access";
    });

    it("applies the coupon to an account's first subscription while early access is open", async () => {
      process.env.CICIRO_EARLY_ACCESS_ENDS = new Date(Date.now() + 86_400_000).toISOString();
      const user = await account("founding");
      expect((await checkout(post("/api/billing/checkout", user.token, { interval: "month" }))).status).toBe(200);
      expect(sessionParams()["discounts[0][coupon]"]).toBe("early_access");
      // Stripe refuses a set discount together with the promotion code box.
      expect(sessionParams().allow_promotion_codes).toBeUndefined();
    });

    it("offers the promotion code box instead once early access has closed", async () => {
      process.env.CICIRO_EARLY_ACCESS_ENDS = new Date(Date.now() - 1000).toISOString();
      const user = await account("late");
      await checkout(post("/api/billing/checkout", user.token, { interval: "year" }));
      expect(sessionParams()["discounts[0][coupon]"]).toBeUndefined();
      expect(sessionParams().allow_promotion_codes).toBe("true");
    });

    it("is for a first subscription only, from any store", async () => {
      const user = await account("returning");
      await prisma.subscription.create({
        data: {
          userId: user.id,
          source: "play_store",
          externalId: `revenuecat:${user.id}:pro:monthly`,
          productId: "pro:monthly",
          status: "expired",
          currentPeriodEnd: new Date(Date.now() - 86_400_000),
        },
      });
      expect((await checkout(post("/api/billing/checkout", user.token, { interval: "month" }))).status).toBe(200);
      expect(sessionParams()["discounts[0][coupon]"]).toBeUndefined();
    });

    it("still sells Pro at full price when Stripe rejects the coupon", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      process.env.STRIPE_EARLY_ACCESS_COUPON = "deleted_coupon";
      const user = await account("nocoupon");
      const res = await checkout(post("/api/billing/checkout", user.token, { interval: "month" }));
      expect(res.status).toBe(200);
      const sessions = fake.requests.filter((r) => r.path === "/v1/checkout/sessions");
      expect(sessions.at(-1)!.params["discounts[0][coupon]"]).toBeUndefined();
      expect(sessions.at(-1)!.params.allow_promotion_codes).toBe("true");
    });

    it("shows the discounted prices from the coupon Checkout will apply", async () => {
      const settings = stripeSettings()!;
      const stripe = getStripe(settings)!;
      const offer = await earlyAccessOffer(stripe, openEarlyAccess()!, await proPrices(stripe, settings));
      expect(offer).toEqual({
        percentOff: 50,
        duration: 12,
        endsAt: null,
        prices: {
          month: { interval: "month", amount: 600, currency: "usd", label: "$6" },
          year: { interval: "year", amount: 4800, currency: "usd", label: "$48" },
        },
      });
      vi.spyOn(console, "error").mockImplementation(() => {});
      process.env.STRIPE_EARLY_ACCESS_COUPON = "deleted_coupon";
      expect(await earlyAccessOffer(stripe, openEarlyAccess()!, {})).toBeNull();
    });

    it("ignores an end date it cannot read, rather than guess", () => {
      process.env.CICIRO_EARLY_ACCESS_ENDS = "next spring";
      expect(openEarlyAccess()).toBeNull();
    });
  });

  describe("Customer Portal", () => {
    it("opens the portal for a web customer and 404s without one", async () => {
      const none = await account("noportal");
      expect((await portal(post("/api/billing/portal", none.token, {}))).status).toBe(404);
      const { user, customer } = await subscribed(fake, "portal");
      const res = await portal(post("/api/billing/portal", user.token, {}));
      expect(await res.json()).toEqual({ url: "https://billing.stripe.test/p/session" });
      const call = fake.requests.find((r) => r.path === "/v1/billing_portal/sessions")!;
      expect(call.params).toMatchObject({ customer, return_url: "http://localhost/pricing" });
    });
  });

  describe("account deletion", () => {
    it("cancels the Stripe subscription before deleting the account", async () => {
      const { user, sub } = await subscribed(fake, "leaver");
      const res = await deleteAccountRoute(
        post("/api/auth/account", user.token, { password: user.password }, "DELETE")
      );
      expect(res.status).toBe(200);
      expect(fake.subscriptions.get(sub.id)!.status).toBe("canceled");
      expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
      expect(await prisma.subscription.count()).toBe(0);
    });

    it("keeps the account when Stripe cannot cancel, so it is never billed after deletion", async () => {
      const { user, sub } = await subscribed(fake, "stuck");
      vi.spyOn(console, "error").mockImplementation(() => {});
      fake.failNext("/v1/subscriptions", 3);
      const res = await deleteAccountRoute(
        post("/api/auth/account", user.token, { password: user.password }, "DELETE")
      );
      expect(res.status).toBe(502);
      expect(fake.subscriptions.get(sub.id)!.status).toBe("active");
      expect(await prisma.user.findUnique({ where: { id: user.id } })).not.toBeNull();
    });

    it("refuses to delete a paying account when Stripe keys are gone", async () => {
      const { user } = await subscribed(fake, "nokeys");
      delete process.env.STRIPE_SECRET_KEY;
      vi.spyOn(console, "error").mockImplementation(() => {});
      const res = await deleteAccountRoute(
        post("/api/auth/account", user.token, { password: user.password }, "DELETE")
      );
      expect(res.status).toBe(502);
      expect(await prisma.user.findUnique({ where: { id: user.id } })).not.toBeNull();
    });

    it("deletes an account that never paid without calling Stripe", async () => {
      const user = await account("free");
      const res = await deleteAccountRoute(
        post("/api/auth/account", user.token, { password: user.password }, "DELETE")
      );
      expect(res.status).toBe(200);
      expect(fake.requests).toHaveLength(0);
    });
  });
});
