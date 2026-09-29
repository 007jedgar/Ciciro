import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { SESSION_HEADER } from "@/lib/auth/constants";
import { hashSessionToken } from "@/lib/auth/tokens";
import { hashPassword } from "@/lib/auth/password";
import { getEntitlement } from "@/lib/entitlements";
import * as notify from "@/lib/billing/notify";
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
async function subscribed(fake: FakeStripe, label: string) {
  const user = await account(label);
  const customer = fake.addCustomer(user.id);
  await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: customer } });
  const sub = fake.addSubscription(customer, { userId: user.id });
  await deliver(fake, fake.event("customer.subscription.created", sub));
  return { user, customer, sub };
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
      const failed = vi.spyOn(notify, "notifyPaymentFailed");
      const event = fake.event("invoice.payment_failed", { object: "invoice", customer });
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
      const canceled = vi.spyOn(notify, "notifySubscriptionCanceled");
      await deliver(fake, fake.event("customer.subscription.deleted", { ...live }));
      await deliver(fake, fake.event("customer.subscription.updated", { ...live, status: "active" }));
      expect((await getEntitlement(user.id)).plan).toBe("free");
      expect(canceled).toHaveBeenCalledTimes(1);
    });

    it("keeps Pro through a failed payment while Stripe retries (past_due)", async () => {
      const { user, sub } = await subscribed(fake, "pastdue");
      fake.subscriptions.get(sub.id)!.status = "past_due";
      await deliver(fake, fake.event("invoice.payment_failed", { object: "invoice", customer: sub.customer }));
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
