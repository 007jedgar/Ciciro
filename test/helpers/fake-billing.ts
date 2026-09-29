import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import Stripe from "stripe";

// Stand-ins for the Stripe and RevenueCat APIs, served over real HTTP so the
// billing code runs through the real Stripe SDK (STRIPE_API_BASE) and its
// own fetch calls (REVENUECAT_API_BASE). Each keeps its state in memory and
// records the requests it saw.

export type Recorded = { method: string; path: string; params: Record<string, string> };

type Handler = (req: Recorded) => { status?: number; body: unknown } | null;

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** Paths that answer 500 for their next `n` requests. */
class Failures {
  private left = new Map<string, number>();
  add(path: string, times: number): void {
    this.left.set(path, times);
  }
  take(path: string): boolean {
    const n = this.left.get(path) ?? 0;
    if (n <= 0) return false;
    this.left.set(path, n - 1);
    return true;
  }
}

async function serve(handle: Handler, requests: Recorded[]): Promise<{ server: Server; base: string }> {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const body = await readBody(req);
    const params: Record<string, string> = {};
    for (const [key, value] of url.searchParams) params[key] = value;
    if (body && !(req.headers["content-type"] ?? "").includes("json")) {
      for (const [key, value] of new URLSearchParams(body)) params[key] = value;
    }
    const recorded = { method: req.method ?? "GET", path: url.pathname, params };
    requests.push(recorded);
    const out = handle(recorded) ?? { status: 404, body: { error: { message: `no fake for ${recorded.path}` } } };
    res.writeHead(out.status ?? 200, { "content-type": "application/json" });
    res.end(JSON.stringify(out.body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

let counter = 0;
const nextId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(counter++).toString(36)}`;

export type FakeStripeSubscription = {
  id: string;
  object: "subscription";
  customer: string;
  status: string;
  cancel_at_period_end: boolean;
  cancel_at: number | null;
  ended_at: number | null;
  livemode: boolean;
  metadata: Record<string, string>;
  items: {
    object: "list";
    data: Array<{ id: string; current_period_end: number; price: { id: string; recurring: { interval: string } } }>;
  };
};

export type FakeStripe = {
  base: string;
  webhookSecret: string;
  requests: Recorded[];
  customers: Map<string, { id: string; object: "customer"; email: string; metadata: Record<string, string> }>;
  subscriptions: Map<string, FakeStripeSubscription>;
  charges: Map<string, { id: string; object: "charge"; customer: string; refunded: boolean }>;
  /** Answer the next `times` requests to `path` with a 500 (the SDK retries twice). */
  failNext: (path: string, times?: number) => void;
  addCustomer: (userId: string) => string;
  addSubscription: (
    customer: string,
    opts?: { status?: string; interval?: "month" | "year"; price?: string; periodEnd?: number; userId?: string }
  ) => FakeStripeSubscription;
  /** A signed webhook delivery for `event` (the Stripe-Signature header and body). */
  sign: (event: Record<string, unknown>) => Promise<{ payload: string; signature: string }>;
  event: (type: string, object: unknown) => Record<string, unknown>;
  close: () => Promise<void>;
};

export async function fakeStripe(): Promise<FakeStripe> {
  const requests: Recorded[] = [];
  const customers: FakeStripe["customers"] = new Map();
  const subscriptions: FakeStripe["subscriptions"] = new Map();
  const charges: FakeStripe["charges"] = new Map();
  const failing = new Failures();

  const handle: Handler = ({ method, path, params }) => {
    if (failing.take(path)) return { status: 500, body: { error: { message: "fake failure" } } };
    let m: RegExpMatchArray | null;
    if (method === "POST" && path === "/v1/customers") {
      const metadata: Record<string, string> = {};
      for (const [key, value] of Object.entries(params)) {
        const meta = key.match(/^metadata\[(.+)\]$/);
        if (meta) metadata[meta[1]] = value;
      }
      const customer = { id: nextId("cus"), object: "customer" as const, email: params.email ?? "", metadata };
      customers.set(customer.id, customer);
      return { body: customer };
    }
    if (method === "GET" && (m = path.match(/^\/v1\/customers\/([^/]+)$/))) {
      const customer = customers.get(m[1]);
      return customer ? { body: customer } : null;
    }
    if (method === "GET" && path === "/v1/subscriptions") {
      const data = [...subscriptions.values()].filter((s) => s.customer === params.customer);
      return { body: { object: "list", data, has_more: false, url: "/v1/subscriptions" } };
    }
    if (method === "DELETE" && (m = path.match(/^\/v1\/subscriptions\/([^/]+)$/))) {
      const sub = subscriptions.get(m[1]);
      if (!sub) return null;
      sub.status = "canceled";
      sub.ended_at = Math.floor(Date.now() / 1000);
      return { body: sub };
    }
    if (method === "POST" && path === "/v1/checkout/sessions") {
      const id = nextId("cs_test");
      return { body: { id, object: "checkout.session", url: `https://checkout.stripe.test/c/pay/${id}` } };
    }
    if (method === "POST" && path === "/v1/billing_portal/sessions") {
      return { body: { id: nextId("bps"), object: "billing_portal.session", url: "https://billing.stripe.test/p/session" } };
    }
    if (method === "GET" && (m = path.match(/^\/v1\/charges\/([^/]+)$/))) {
      const charge = charges.get(m[1]);
      return charge ? { body: charge } : null;
    }
    return null;
  };

  const { server, base } = await serve(handle, requests);
  const webhookSecret = "whsec_test_fake";
  const stripe = new Stripe("sk_test_fake");

  return {
    base,
    webhookSecret,
    requests,
    customers,
    subscriptions,
    charges,
    failNext: (path, times = 1) => failing.add(path, times),
    addCustomer: (userId) => {
      const customer = { id: nextId("cus"), object: "customer" as const, email: "", metadata: { userId } };
      customers.set(customer.id, customer);
      return customer.id;
    },
    addSubscription: (customer, opts = {}) => {
      const interval = opts.interval ?? "month";
      const sub: FakeStripeSubscription = {
        id: nextId("sub"),
        object: "subscription",
        customer,
        status: opts.status ?? "active",
        cancel_at_period_end: false,
        cancel_at: null,
        ended_at: null,
        livemode: false,
        metadata: opts.userId ? { userId: opts.userId } : {},
        items: {
          object: "list",
          data: [
            {
              id: nextId("si"),
              current_period_end: opts.periodEnd ?? Math.floor(Date.now() / 1000) + 30 * 86400,
              price: { id: opts.price ?? `price_pro_${interval}`, recurring: { interval } },
            },
          ],
        },
      };
      subscriptions.set(sub.id, sub);
      return sub;
    },
    event: (type, object) => ({
      id: nextId("evt"),
      object: "event",
      type,
      api_version: "2026-08-26.dahlia",
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      data: { object },
    }),
    sign: async (event) => {
      const payload = JSON.stringify(event);
      const signature = await stripe.webhooks.generateTestHeaderStringAsync({
        payload,
        secret: webhookSecret,
        cryptoProvider: Stripe.createSubtleCryptoProvider(),
      });
      return { payload, signature };
    },
    close: () => close(server),
  };
}

export type FakeRevenueCatSubscription = {
  expires_date: string | null;
  purchase_date?: string;
  store: string;
  is_sandbox?: boolean;
  unsubscribe_detected_at?: string | null;
  billing_issues_detected_at?: string | null;
  refunded_at?: string | null;
  grace_period_expires_date?: string | null;
};

export type FakeRevenueCat = {
  base: string;
  secretApiKey: string;
  webhookAuthorization: string;
  requests: Recorded[];
  /** Subscriptions by app user id, then product id: what GET /v1/subscribers returns. */
  subscribers: Map<string, Record<string, FakeRevenueCatSubscription>>;
  failNext: (path: string, times?: number) => void;
  close: () => Promise<void>;
};

export async function fakeRevenueCat(): Promise<FakeRevenueCat> {
  const requests: Recorded[] = [];
  const subscribers: FakeRevenueCat["subscribers"] = new Map();
  const failing = new Failures();
  const secretApiKey = "sk_rc_fake";
  const handle: Handler = ({ method, path }) => {
    if (failing.take(path)) return { status: 500, body: { message: "fake failure" } };
    const m = path.match(/^\/v1\/subscribers\/([^/]+)$/);
    if (!m) return null;
    const id = decodeURIComponent(m[1]);
    if (method === "DELETE") {
      subscribers.delete(id);
      return { body: { app_user_id: id, deleted: true } };
    }
    return {
      body: {
        request_date: new Date().toISOString(),
        subscriber: { original_app_user_id: id, subscriptions: subscribers.get(id) ?? {}, entitlements: {} },
      },
    };
  };
  const { server, base } = await serve(handle, requests);
  return {
    base,
    secretApiKey,
    webhookAuthorization: "Bearer rc-webhook-secret",
    requests,
    subscribers,
    failNext: (path, times = 1) => failing.add(path, times),
    close: () => close(server),
  };
}

const BILLING_ENV = [
  "CICIRO_REQUIRE_AUTH",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_PRO_MONTHLY",
  "STRIPE_PRICE_PRO_YEARLY",
  "STRIPE_API_BASE",
  "STRIPE_TAX_MODE",
  "REVENUECAT_SECRET_API_KEY",
  "REVENUECAT_WEBHOOK_AUTH",
  "REVENUECAT_API_BASE",
  "REVENUECAT_YEARLY_PRODUCT_IDS",
  "CICIRO_FREE_AI_RUNS_PER_MONTH",
  "CICIRO_PRO_AI_RUNS_PER_MONTH",
  "ANTHROPIC_API_KEY",
] as const;

/** Snapshot the billing env vars; the returned function restores them. */
export function saveBillingEnv(): () => void {
  const saved = Object.fromEntries(BILLING_ENV.map((name) => [name, process.env[name]]));
  for (const name of BILLING_ENV) delete process.env[name];
  return () => {
    for (const name of BILLING_ENV) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  };
}

export function useFakeStripe(fake: FakeStripe): void {
  process.env.STRIPE_SECRET_KEY = "sk_test_fake";
  process.env.STRIPE_WEBHOOK_SECRET = fake.webhookSecret;
  process.env.STRIPE_PRICE_PRO_MONTHLY = "price_pro_month";
  process.env.STRIPE_PRICE_PRO_YEARLY = "price_pro_year";
  process.env.STRIPE_API_BASE = fake.base;
}

export function useFakeRevenueCat(fake: FakeRevenueCat): void {
  process.env.REVENUECAT_SECRET_API_KEY = fake.secretApiKey;
  process.env.REVENUECAT_WEBHOOK_AUTH = fake.webhookAuthorization;
  process.env.REVENUECAT_API_BASE = fake.base;
  process.env.REVENUECAT_YEARLY_PRODUCT_IDS = "ciciro_pro_yearly";
}
