import { prisma } from "@/lib/db";
import { authRequired } from "@/lib/auth/constants";
import { AuthError, type PublicUser } from "@/lib/auth/session";
import {
  PLAN_NAMES,
  androidPackage,
  planLimits,
  revenueCatSettings,
  stripeSettings,
  type BillingInterval,
  type PlanId,
  type PlanLimits,
  type SubscriptionSource,
} from "@/lib/billing/config";

// What an account may do, and how much AI it has used this month. The server
// is the one entitlement authority: every client (web, iOS, Android) renders
// from getEntitlement, which reads only Subscription rows, whichever store
// sold them. See docs/billing.md.

/** Stripe statuses (and the store states mapped onto them) that keep Pro on. */
const ENTITLING_STATUSES = new Set(["active", "trialing", "past_due"]);

export type Entitlement = {
  plan: PlanId;
  planName: string;
  /** Where the paid plan was bought; null on the free plan. */
  source: SubscriptionSource | null;
  status: string | null;
  interval: BillingInterval | null;
  /** ISO time the current paid period ends (renews, or lapses when cancelling). */
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** Whether AI use is capped. Only hosted accounts are; self-hosted use never is. */
  metered: boolean;
  limits: PlanLimits;
  /** Every plan's allowance, so an upgrade screen can say what Pro adds. */
  plans: Record<PlanId, PlanLimits>;
  usage: { period: string; aiRuns: number };
  /** What this server can sell: web Checkout (Stripe) and store purchases (RevenueCat). */
  billing: { web: boolean; store: boolean };
  /** Where a store subscriber manages or cancels; null for Stripe (use the Portal). */
  manageUrl: string | null;
};

export type SubscriptionRow = {
  source: string;
  productId: string;
  plan: string;
  interval: string;
  status: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
};

/** "YYYY-MM" of `now` in UTC: the metering period. */
export function usagePeriod(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

/**
 * Whether a subscription grants its plan right now. Stripe keeps its status
 * current itself; a store row also needs its period to still be running, in
 * case the expiration webhook is late.
 */
export function isEntitling(sub: SubscriptionRow, now = new Date()): boolean {
  if (!ENTITLING_STATUSES.has(sub.status)) return false;
  if (sub.source === "stripe") return true;
  return !sub.currentPeriodEnd || sub.currentPeriodEnd.getTime() > now.getTime();
}

/** The subscription that decides the plan: any entitling one, latest-ending first. */
export function activeSubscription<T extends SubscriptionRow>(subs: T[], now = new Date()): T | null {
  const live = subs.filter((sub) => isEntitling(sub, now));
  live.sort(
    (a, b) => (b.currentPeriodEnd?.getTime() ?? Infinity) - (a.currentPeriodEnd?.getTime() ?? Infinity)
  );
  return live[0] ?? null;
}

function storeManageUrl(sub: SubscriptionRow): string | null {
  if (sub.source === "app_store") return "https://apps.apple.com/account/subscriptions";
  if (sub.source === "play_store") {
    // RevenueCat names a Play subscription "<subscriptionId>:<basePlanId>".
    const sku = encodeURIComponent(sub.productId.split(":")[0]);
    return `https://play.google.com/store/account/subscriptions?sku=${sku}&package=${encodeURIComponent(androidPackage())}`;
  }
  return null;
}

/** Build an entitlement from an account's subscriptions and usage. Pure. */
export function resolveEntitlement(
  subs: SubscriptionRow[],
  aiRuns: number,
  opts: { metered: boolean; now?: Date }
): Entitlement {
  const now = opts.now ?? new Date();
  const active = activeSubscription(subs, now);
  const plan: PlanId = active && active.plan === "pro" ? "pro" : "free";
  return {
    plan,
    planName: PLAN_NAMES[plan],
    source: active ? (active.source as SubscriptionSource) : null,
    status: active?.status ?? null,
    interval: active && (active.interval === "month" || active.interval === "year") ? active.interval : null,
    currentPeriodEnd: active?.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: active?.cancelAtPeriodEnd ?? false,
    metered: opts.metered,
    limits: opts.metered ? planLimits(plan) : { aiRunsPerMonth: null },
    plans: { free: planLimits("free"), pro: planLimits("pro") },
    usage: { period: usagePeriod(now), aiRuns },
    billing: { web: stripeSettings() !== null, store: revenueCatSettings() !== null },
    manageUrl: active ? storeManageUrl(active) : null,
  };
}

export async function getEntitlement(userId: string, now = new Date()): Promise<Entitlement> {
  const [subs, counter] = await Promise.all([
    prisma.subscription.findMany({ where: { userId } }),
    prisma.usageCounter.findUnique({
      where: { userId_period: { userId, period: usagePeriod(now) } },
      select: { aiRuns: true },
    }),
  ]);
  return resolveEntitlement(subs, counter?.aiRuns ?? 0, { metered: authRequired(), now });
}

export const AI_LIMIT_CODE = "ai_limit_reached";

/**
 * The month's AI allowance is used up. An AuthError so every route's existing
 * responseFromAuthError answers it: 402 with { error, code, entitlement }.
 */
export class AiLimitError extends AuthError {
  constructor(entitlement: Entitlement) {
    const message =
      entitlement.plan === "free"
        ? "You've used this month's free AI allowance."
        : "You've reached this month's AI limit.";
    super(message, 402, { error: message, code: AI_LIMIT_CODE, entitlement });
  }
}

function overLimit(entitlement: Entitlement, runs = entitlement.usage.aiRuns): boolean {
  const cap = entitlement.limits.aiRunsPerMonth;
  return entitlement.metered && cap !== null && runs >= cap;
}

/**
 * Throw AiLimitError when the account has no AI left this month; otherwise
 * return its entitlement. Without a user (self-hosted, signed out) there is
 * nothing to meter; hosted routes have already required a session.
 */
export async function assertAiAllowed(user: PublicUser | null): Promise<Entitlement | null> {
  if (!user || !authRequired()) return null;
  const entitlement = await getEntitlement(user.id);
  if (overLimit(entitlement)) throw new AiLimitError(entitlement);
  return entitlement;
}

/** For background AI (summaries, spelling): quietly skip once the allowance is gone. */
export async function aiAllowed(user: PublicUser | null): Promise<boolean> {
  try {
    await assertAiAllowed(user);
    return true;
  } catch (error) {
    if (error instanceof AiLimitError) return false;
    throw error;
  }
}

/**
 * Charge one AI action to this month's allowance, or throw AiLimitError when
 * none is left. Counts before the model runs, so concurrent requests cannot
 * overdraw: the increment is atomic and one that lands past the cap is
 * returned. Call it once per author-initiated action (a chat turn, an
 * autowrite, a check), not per model call.
 */
export async function meterAiRun(user: PublicUser | null): Promise<void> {
  const entitlement = await assertAiAllowed(user);
  if (!user || !entitlement || !entitlement.metered) return;
  const period = entitlement.usage.period;
  const counter = await prisma.usageCounter.upsert({
    where: { userId_period: { userId: user.id, period } },
    create: { userId: user.id, period, aiRuns: 1 },
    update: { aiRuns: { increment: 1 } },
    select: { aiRuns: true },
  });
  if (overLimit(entitlement, counter.aiRuns - 1)) {
    await prisma.usageCounter.update({
      where: { userId_period: { userId: user.id, period } },
      data: { aiRuns: { decrement: 1 } },
    });
    throw new AiLimitError({ ...entitlement, usage: { period, aiRuns: counter.aiRuns - 1 } });
  }
}

/** Give back an AI action that failed before the author got anything from it. */
export async function refundAiRun(user: PublicUser | null): Promise<void> {
  if (!user || !authRequired()) return;
  await prisma.usageCounter
    .updateMany({
      where: { userId: user.id, period: usagePeriod(), aiRuns: { gt: 0 } },
      data: { aiRuns: { decrement: 1 } },
    })
    .catch(() => {});
}

/**
 * Meter one AI action around `run`: charged up front (throwing AiLimitError
 * when the allowance is gone) and refunded if `run` throws.
 */
export async function withAiRun<T>(user: PublicUser | null, run: () => Promise<T>): Promise<T> {
  await meterAiRun(user);
  try {
    return await run();
  } catch (error) {
    await refundAiRun(user);
    throw error;
  }
}
