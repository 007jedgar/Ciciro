import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { SESSION_HEADER } from "@/lib/auth/constants";
import { hashSessionToken } from "@/lib/auth/tokens";
import { hashPassword } from "@/lib/auth/password";
import { getEntitlement } from "@/lib/entitlements";
import { storeStatus } from "@/lib/billing/revenuecat";
import * as analyticsServer from "@/lib/analytics-server";
import { POST as webhook } from "@/app/api/billing/webhooks/revenuecat/route";
import { POST as sync } from "@/app/api/billing/sync/route";
import { DELETE as deleteAccountRoute } from "@/app/api/auth/account/route";
import { wipeDatabase } from "./account-fixture";
import { fakeRevenueCat, saveBillingEnv, useFakeRevenueCat, type FakeRevenueCat } from "./helpers/fake-billing";

const DAY = 86_400_000;
const future = (days = 30) => new Date(Date.now() + days * DAY).toISOString();
const past = (days = 1) => new Date(Date.now() - days * DAY).toISOString();

async function account(label: string) {
  const password = `${label}-password`;
  const user = await prisma.user.create({
    data: { email: `${label}@example.com`, name: label, passwordHash: await hashPassword(password) },
  });
  const token = `${label}-token`;
  await prisma.session.create({
    data: { userId: user.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3_600_000) },
  });
  return { id: user.id, token, password };
}

let eventCount = 0;
function rcEvent(type: string, appUserId: string, extra: Record<string, unknown> = {}) {
  return { api_version: "1.0", event: { id: `rc-evt-${eventCount++}`, type, app_user_id: appUserId, ...extra } };
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

async function deliver(fake: FakeRevenueCat, payload: unknown, authorization: string | null = fake.webhookAuthorization) {
  const res = await webhook(
    new NextRequest("http://localhost/api/billing/webhooks/revenuecat", {
      method: "POST",
      headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
      body: JSON.stringify(payload),
    })
  );
  return { status: res.status, body: await res.json() };
}

describe("RevenueCat billing", () => {
  let fake: FakeRevenueCat;
  let restoreEnv: () => void;

  beforeAll(async () => {
    fake = await fakeRevenueCat();
  });
  afterAll(async () => {
    await fake.close();
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    restoreEnv = saveBillingEnv();
    process.env.CICIRO_REQUIRE_AUTH = "true";
    useFakeRevenueCat(fake);
    await wipeDatabase();
    fake.subscribers.clear();
    fake.requests.length = 0;
  });
  afterEach(() => restoreEnv());

  it("rejects a delivery without the configured Authorization header", async () => {
    const user = await account("forged");
    expect((await deliver(fake, rcEvent("INITIAL_PURCHASE", user.id), null)).status).toBe(401);
    expect((await deliver(fake, rcEvent("INITIAL_PURCHASE", user.id), "Bearer guess")).status).toBe(401);
    expect(fake.requests).toHaveLength(0);
    expect(await prisma.billingEvent.count()).toBe(0);
  });

  it("answers 404 when store billing is not configured", async () => {
    delete process.env.REVENUECAT_SECRET_API_KEY;
    const user = await account("off");
    expect((await deliver(fake, rcEvent("INITIAL_PURCHASE", user.id))).status).toBe(404);
  });

  it("turns Pro on from a purchase by re-fetching the customer", async () => {
    const user = await account("iap");
    fake.subscribers.set(user.id, {
      ciciro_pro_yearly: { store: "app_store", expires_date: future(365), is_sandbox: true },
    });
    const { status, body } = await deliver(fake, rcEvent("INITIAL_PURCHASE", user.id));
    expect(status).toBe(200);
    expect(body).toEqual({ received: true, duplicate: false });
    expect(fake.requests[0]).toMatchObject({ method: "GET", path: `/v1/subscribers/${user.id}` });
    expect(await getEntitlement(user.id)).toMatchObject({
      plan: "pro",
      source: "app_store",
      interval: "year",
      manageUrl: "https://apps.apple.com/account/subscriptions",
    });
    const row = await prisma.subscription.findFirstOrThrow({ where: { userId: user.id } });
    expect(row).toMatchObject({ sandbox: true, productId: "ciciro_pro_yearly", status: "active" });
  });

  it("tolerates duplicate deliveries", async () => {
    const user = await account("dupe");
    fake.subscribers.set(user.id, { ciciro_pro_monthly: { store: "play_store", expires_date: future() } });
    const payload = rcEvent("RENEWAL", user.id);
    expect((await deliver(fake, payload)).body.duplicate).toBe(false);
    expect((await deliver(fake, payload)).body.duplicate).toBe(true);
    expect(await prisma.subscription.count()).toBe(1);
    expect(await prisma.billingEvent.count()).toBe(1);
    const entitlement = await getEntitlement(user.id);
    expect(entitlement.source).toBe("play_store");
    expect(entitlement.manageUrl).toBe(
      "https://play.google.com/store/account/subscriptions?sku=ciciro_pro_monthly&package=app.ciciro.mobile"
    );
  });

  it("drops to free on expiration and on a store refund", async () => {
    const user = await account("lapse");
    fake.subscribers.set(user.id, { ciciro_pro_monthly: { store: "app_store", expires_date: future() } });
    await deliver(fake, rcEvent("INITIAL_PURCHASE", user.id));
    expect((await getEntitlement(user.id)).plan).toBe("pro");

    fake.subscribers.set(user.id, {
      ciciro_pro_monthly: { store: "app_store", expires_date: future(), refunded_at: past(0) },
    });
    await deliver(fake, rcEvent("CANCELLATION", user.id, { cancel_reason: "CUSTOMER_SUPPORT" }));
    expect((await getEntitlement(user.id)).plan).toBe("free");

    fake.subscribers.set(user.id, { ciciro_pro_monthly: { store: "app_store", expires_date: past() } });
    await deliver(fake, rcEvent("EXPIRATION", user.id));
    const row = await prisma.subscription.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.status).toBe("expired");
  });

  it("fires subscription_canceled on auto-renew off, and subscription_ended once access is actually gone", async () => {
    const user = await account("lifecycle-analytics");
    fake.subscribers.set(user.id, { ciciro_pro_monthly: { store: "app_store", expires_date: future() } });
    await deliver(fake, rcEvent("INITIAL_PURCHASE", user.id));
    const captured = captureAnalytics();

    await deliver(fake, rcEvent("CANCELLATION", user.id, { cancel_reason: "CUSTOMER_SUPPORT" }));
    await deliver(fake, rcEvent("EXPIRATION", user.id));

    expect(captured()).toEqual([
      {
        userId: user.id,
        event: "subscription_canceled",
        properties: { plan: "pro", platform: "ios", reason: "refund" },
      },
      { userId: user.id, event: "subscription_ended", properties: { plan: "pro", platform: "ios" } },
    ]);
  });

  it("says why a store subscription stopped renewing", async () => {
    const user = await account("reason-analytics");
    fake.subscribers.set(user.id, { ciciro_pro_monthly: { store: "app_store", expires_date: future() } });
    await deliver(fake, rcEvent("INITIAL_PURCHASE", user.id));
    const captured = captureAnalytics();

    await deliver(fake, rcEvent("CANCELLATION", user.id, { cancel_reason: "BILLING_ERROR" }));
    await deliver(fake, rcEvent("CANCELLATION", user.id, { cancel_reason: "UNSUBSCRIBE" }));
    await deliver(fake, rcEvent("CANCELLATION", user.id, { cancel_reason: "PRICE_INCREASE" }));

    expect(captured().map((c) => c.properties)).toEqual([
      { plan: "pro", platform: "ios", reason: "billing_failure" },
      { plan: "pro", platform: "ios", reason: "voluntary" },
      { plan: "pro", platform: "ios", reason: "other" },
    ]);
  });

  it("keeps Pro through a billing issue and a turned-off auto-renew", async () => {
    const user = await account("issues");
    fake.subscribers.set(user.id, {
      ciciro_pro_monthly: {
        store: "app_store",
        expires_date: past(0.1),
        grace_period_expires_date: future(6),
        billing_issues_detected_at: past(0.1),
        unsubscribe_detected_at: past(0.5),
      },
    });
    await deliver(fake, rcEvent("BILLING_ISSUE", user.id));
    expect(await getEntitlement(user.id)).toMatchObject({ plan: "pro", status: "past_due", cancelAtPeriodEnd: true });
  });

  it("moves Pro between accounts on a transfer", async () => {
    const from = await account("from");
    const to = await account("to");
    fake.subscribers.set(from.id, { ciciro_pro_monthly: { store: "app_store", expires_date: future() } });
    await deliver(fake, rcEvent("INITIAL_PURCHASE", from.id));
    fake.subscribers.set(from.id, {});
    fake.subscribers.set(to.id, { ciciro_pro_monthly: { store: "app_store", expires_date: future() } });
    await deliver(fake, rcEvent("TRANSFER", "", { app_user_id: undefined, transferred_from: [from.id], transferred_to: [to.id] }));
    expect((await getEntitlement(from.id)).plan).toBe("free");
    expect((await getEntitlement(to.id)).plan).toBe("pro");
  });

  it("ignores anonymous ids, unknown accounts, and Stripe or promotional entries", async () => {
    const user = await account("mixed");
    fake.subscribers.set(user.id, {
      stripe_price: { store: "stripe", expires_date: future() },
      rc_promo_pro_monthly: { store: "promotional", expires_date: future() },
    });
    await deliver(fake, rcEvent("INITIAL_PURCHASE", "$RCAnonymousID:abc"));
    await deliver(fake, rcEvent("INITIAL_PURCHASE", "not-a-user"));
    await deliver(fake, rcEvent("INITIAL_PURCHASE", user.id));
    expect(await prisma.subscription.count()).toBe(0);
    expect(fake.requests.map((r) => r.path)).toEqual([`/v1/subscribers/${user.id}`]);
  });

  it("releases the event when RevenueCat cannot be read, so the retry runs", async () => {
    const user = await account("retry");
    fake.subscribers.set(user.id, { ciciro_pro_monthly: { store: "app_store", expires_date: future() } });
    const payload = rcEvent("INITIAL_PURCHASE", user.id);
    fake.failNext(`/v1/subscribers/${user.id}`);
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await deliver(fake, payload)).status).toBe(500);
    expect(await prisma.billingEvent.count()).toBe(0);
    expect((await deliver(fake, payload)).body).toEqual({ received: true, duplicate: false });
    expect((await getEntitlement(user.id)).plan).toBe("pro");
  });

  it("syncs a purchase for the signed-in account on request", async () => {
    const user = await account("restore");
    fake.subscribers.set(user.id, { ciciro_pro_monthly: { store: "app_store", expires_date: future() } });
    const res = await sync(
      new NextRequest("http://localhost/api/billing/sync", { method: "POST", headers: { [SESSION_HEADER]: user.token } })
    );
    expect(res.status).toBe(200);
    expect((await res.json()).entitlement).toMatchObject({ plan: "pro", source: "app_store" });
    const anonymous = await sync(new NextRequest("http://localhost/api/billing/sync", { method: "POST" }));
    expect(anonymous.status).toBe(401);
  });

  it("deletes the RevenueCat customer with the account, without blocking on it", async () => {
    const user = await account("gone");
    fake.subscribers.set(user.id, { ciciro_pro_monthly: { store: "app_store", expires_date: future() } });
    await deliver(fake, rcEvent("INITIAL_PURCHASE", user.id));
    const res = await deleteAccountRoute(
      new NextRequest("http://localhost/api/auth/account", {
        method: "DELETE",
        headers: { "content-type": "application/json", [SESSION_HEADER]: user.token },
        body: JSON.stringify({ password: user.password }),
      })
    );
    expect(res.status).toBe(200);
    expect(fake.requests.at(-1)).toMatchObject({ method: "DELETE", path: `/v1/subscribers/${user.id}` });
    expect(await prisma.subscription.count()).toBe(0);
  });
});

describe("storeStatus", () => {
  const now = new Date("2026-09-29T12:00:00Z");
  it("maps RevenueCat subscription states onto Stripe's words", () => {
    expect(storeStatus({ store: "app_store", expires_date: "2026-10-29T12:00:00Z" }, now)).toBe("active");
    expect(storeStatus({ store: "app_store", expires_date: "2026-09-28T12:00:00Z" }, now)).toBe("expired");
    expect(
      storeStatus({ store: "app_store", expires_date: "2026-10-29T12:00:00Z", refunded_at: "2026-09-29T00:00:00Z" }, now)
    ).toBe("canceled");
    expect(
      storeStatus(
        {
          store: "play_store",
          expires_date: "2026-09-28T12:00:00Z",
          grace_period_expires_date: "2026-10-02T12:00:00Z",
          billing_issues_detected_at: "2026-09-28T12:00:00Z",
        },
        now
      )
    ).toBe("past_due");
    expect(storeStatus({ store: "app_store", expires_date: null }, now)).toBe("active");
  });
});
