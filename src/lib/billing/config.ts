// Billing configuration: the plans, their AI allowances, and the Stripe and
// RevenueCat settings, all read from the environment so nothing about pricing
// is hard-coded. See docs/billing.md for every variable.
//
// PLACEHOLDERS: the allowance defaults below are not final numbers. Set them
// with the env vars named next to each before launch.

// Bracket access so Next.js cannot replace these with empty strings from the
// Workers CI build environment. The hosted Worker copies secrets onto
// process.env per request in src/worker/index.ts.
function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** A monthly allowance: a whole number, or "unlimited" for no cap. */
function readAllowance(name: string, fallback: number): number | null {
  const raw = readEnv(name);
  if (raw === undefined) return fallback;
  if (raw.toLowerCase() === "unlimited") return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

export type PlanId = "free" | "pro";
export type BillingInterval = "month" | "year";
export type SubscriptionSource = "stripe" | "app_store" | "play_store";

export type PlanLimits = {
  /** AI actions per calendar month (UTC); null means no cap. */
  aiRunsPerMonth: number | null;
};

export const PLAN_NAMES: Record<PlanId, string> = {
  free: "Free",
  pro: "Ciciro Pro",
};

/** PLACEHOLDER defaults: CICIRO_FREE_AI_RUNS_PER_MONTH, CICIRO_PRO_AI_RUNS_PER_MONTH. */
const DEFAULT_FREE_AI_RUNS = 30;
const DEFAULT_PRO_AI_RUNS = 1500;

export function planLimits(plan: PlanId): PlanLimits {
  if (plan === "pro") {
    return { aiRunsPerMonth: readAllowance("CICIRO_PRO_AI_RUNS_PER_MONTH", DEFAULT_PRO_AI_RUNS) };
  }
  return { aiRunsPerMonth: readAllowance("CICIRO_FREE_AI_RUNS_PER_MONTH", DEFAULT_FREE_AI_RUNS) };
}

export type StripeSettings = {
  secretKey: string;
  webhookSecret: string;
  prices: Record<BillingInterval, string>;
  /** Point the SDK at stripe-mock or another stand-in, e.g. http://localhost:12111. */
  apiBase?: string;
};

/**
 * Stripe settings, or null when web billing is not set up. Every value is
 * required: without them the pricing page, Checkout and the Settings billing
 * section stay hidden and everyone is on the free plan.
 */
export function stripeSettings(): StripeSettings | null {
  const secretKey = readEnv("STRIPE_SECRET_KEY");
  const webhookSecret = readEnv("STRIPE_WEBHOOK_SECRET");
  const month = readEnv("STRIPE_PRICE_PRO_MONTHLY");
  const year = readEnv("STRIPE_PRICE_PRO_YEARLY");
  if (!secretKey || !webhookSecret || !month || !year) return null;
  return {
    secretKey,
    webhookSecret,
    prices: { month, year },
    apiBase: readEnv("STRIPE_API_BASE"),
  };
}

export type EarlyAccessSettings = {
  /** The Stripe coupon Checkout applies, e.g. a percent off for some months. */
  couponId: string;
  /** When the offer closes; null keeps it open until the coupon is unset. */
  endsAt: Date | null;
};

/**
 * The early-access offer, or null when there is none: a Stripe coupon that
 * Checkout applies to an account's first Pro subscription while early access
 * is open. The coupon itself (percent and months) lives in Stripe, like the
 * prices, and the same offer is set up as an introductory offer in App Store
 * Connect and Play Console. See docs/billing.md.
 */
export function earlyAccessSettings(): EarlyAccessSettings | null {
  const couponId = readEnv("STRIPE_EARLY_ACCESS_COUPON");
  if (!couponId) return null;
  const rawEnd = readEnv("CICIRO_EARLY_ACCESS_ENDS");
  const endsAt = rawEnd ? new Date(rawEnd) : null;
  if (endsAt && Number.isNaN(endsAt.getTime())) return null;
  return { couponId, endsAt };
}

/** The offer while it is open at `now`, or null once it has closed. */
export function openEarlyAccess(now: Date = new Date()): EarlyAccessSettings | null {
  const offer = earlyAccessSettings();
  if (!offer) return null;
  return offer.endsAt && offer.endsAt.getTime() <= now.getTime() ? null : offer;
}

export type RevenueCatSettings = {
  /** RevenueCat secret API key (v1), for re-fetching a customer server-side. */
  secretApiKey: string;
  /** The exact Authorization header value set on the RevenueCat webhook. */
  webhookAuthorization: string;
  /** Store product ids that bill yearly; everything else is monthly. */
  yearlyProductIds: string[];
  apiBase: string;
};

/**
 * RevenueCat settings, or null when store purchases are not set up. Ciciro
 * sells nothing in the stores but Ciciro Pro, so every App Store or Google
 * Play subscription RevenueCat reports counts as Pro.
 */
export function revenueCatSettings(): RevenueCatSettings | null {
  const secretApiKey = readEnv("REVENUECAT_SECRET_API_KEY");
  const webhookAuthorization = readEnv("REVENUECAT_WEBHOOK_AUTH");
  if (!secretApiKey || !webhookAuthorization) return null;
  return {
    secretApiKey,
    webhookAuthorization,
    yearlyProductIds: (readEnv("REVENUECAT_YEARLY_PRODUCT_IDS") ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
    apiBase: readEnv("REVENUECAT_API_BASE") ?? "https://api.revenuecat.com",
  };
}

/** The Android package, for the Play subscription-management link. */
export function androidPackage(): string {
  return readEnv("ANDROID_PACKAGE") ?? "app.ciciro.mobile";
}
