import { prisma } from "@/lib/db";
import { authRequired } from "@/lib/auth/constants";
import { AuthError, type PublicUser } from "@/lib/auth/session";
import { publicOrigin } from "@/lib/public-origin";
import { maybeSendAllowanceNudge } from "@/lib/email/allowance-nudge";
import { autowriteWeight } from "@/lib/billing/metering";
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
  usage: { period: string; aiRuns: number; autowriteWords: number };
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
  usage: { aiRuns: number; autowriteWords?: number },
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
    limits: opts.metered ? planLimits(plan) : { aiRunsPerMonth: null, autowriteWordsPerMonth: null },
    plans: { free: planLimits("free"), pro: planLimits("pro") },
    usage: { period: usagePeriod(now), aiRuns: usage.aiRuns, autowriteWords: usage.autowriteWords ?? 0 },
    billing: { web: stripeSettings() !== null, store: revenueCatSettings() !== null },
    manageUrl: active ? storeManageUrl(active) : null,
  };
}

export async function getEntitlement(userId: string, now = new Date()): Promise<Entitlement> {
  const [subs, counter] = await Promise.all([
    prisma.subscription.findMany({ where: { userId } }),
    prisma.usageCounter.findUnique({
      where: { userId_period: { userId, period: usagePeriod(now) } },
      select: { aiRuns: true, autowriteWords: true },
    }),
  ]);
  return resolveEntitlement(
    subs,
    { aiRuns: counter?.aiRuns ?? 0, autowriteWords: counter?.autowriteWords ?? 0 },
    { metered: authRequired(), now }
  );
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

export const AUTOWRITE_CAP_CODE = "autowrite_word_cap_reached";

/**
 * The month's autowrite word cap is used up - a separate limit from the unit
 * allowance above (see src/lib/billing/metering.ts): a free or Pro account
 * can still have units left and be refused here. An AuthError for the same
 * reason as AiLimitError.
 */
export class AutowriteCapError extends AuthError {
  constructor(entitlement: Entitlement, wordsLeft: number) {
    const cap = entitlement.limits.autowriteWordsPerMonth ?? 0;
    const left = Math.max(0, wordsLeft);
    // The client formats when the period (entitlement.usage.period) resets,
    // the same way it already does for AiLimitError (allowanceResetsOn).
    const message = `This month's autowrite limit is ${cap.toLocaleString("en-US")} words; ${left.toLocaleString("en-US")} left.`;
    super(message, 402, { error: message, code: AUTOWRITE_CAP_CODE, entitlement, wordsLeft: left });
  }
}

/** Whether charging `weight` more units would push `used` past `cap`. */
function wouldExceed(cap: number | null, metered: boolean, used: number, weight: number): boolean {
  return metered && cap !== null && used + weight > cap;
}

/**
 * Throw AiLimitError when charging `weight` more units (1 for everything but
 * autowrite, see autowriteWeight) would have no AI left this month; otherwise
 * return the entitlement. Without a user (self-hosted, signed out) there is
 * nothing to meter; hosted routes have already required a session.
 */
export async function assertAiAllowed(user: PublicUser | null, weight = 1): Promise<Entitlement | null> {
  if (!user || !authRequired()) return null;
  const entitlement = await getEntitlement(user.id);
  if (wouldExceed(entitlement.limits.aiRunsPerMonth, entitlement.metered, entitlement.usage.aiRuns, weight)) {
    throw new AiLimitError(entitlement);
  }
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
 * Charge `weight` allowance units (default 1), or throw AiLimitError when
 * that would exceed what's left this month. Counts before the model runs, so
 * concurrent requests cannot overdraw: the increment is atomic and one that
 * lands past the cap is undone. Call it once per author-initiated action (a
 * chat turn, a check), not per model call.
 */
export async function meterAiRun(user: PublicUser | null, weight = 1): Promise<void> {
  const entitlement = await assertAiAllowed(user, weight);
  if (!user || !entitlement || !entitlement.metered) return;
  const period = entitlement.usage.period;
  const counter = await prisma.usageCounter.upsert({
    where: { userId_period: { userId: user.id, period } },
    create: { userId: user.id, period, aiRuns: weight },
    update: { aiRuns: { increment: weight } },
    select: { aiRuns: true },
  });
  if (wouldExceed(entitlement.limits.aiRunsPerMonth, entitlement.metered, counter.aiRuns - weight, weight)) {
    await prisma.usageCounter.update({
      where: { userId_period: { userId: user.id, period } },
      data: { aiRuns: { decrement: weight } },
    });
    throw new AiLimitError({ ...entitlement, usage: { ...entitlement.usage, aiRuns: counter.aiRuns - weight } });
  }
  await maybeSendAllowanceNudge(
    user.id,
    user.email,
    { ...entitlement, usage: { ...entitlement.usage, aiRuns: counter.aiRuns } },
    publicOrigin("")
  ).catch((error) => console.error("allowance nudge failed", error));
}

/**
 * Charge one autowrite run: `autowriteWeight(targetWords)` allowance units,
 * plus `targetWords` against the separate monthly autowrite word cap. The two
 * limits are independent, so either can refuse the run; neither is charged
 * unless both pass.
 */
export async function meterAutowrite(user: PublicUser | null, targetWords: number): Promise<void> {
  const weight = autowriteWeight(targetWords);
  const entitlement = await assertAiAllowed(user, weight);
  if (!user || !entitlement || !entitlement.metered) return;
  const cap = entitlement.limits.autowriteWordsPerMonth;
  if (cap !== null && entitlement.usage.autowriteWords + targetWords > cap) {
    throw new AutowriteCapError(entitlement, cap - entitlement.usage.autowriteWords);
  }
  const period = entitlement.usage.period;
  const counter = await prisma.usageCounter.upsert({
    where: { userId_period: { userId: user.id, period } },
    create: { userId: user.id, period, aiRuns: weight, autowriteWords: targetWords },
    update: { aiRuns: { increment: weight }, autowriteWords: { increment: targetWords } },
    select: { aiRuns: true, autowriteWords: true },
  });
  const overRuns = wouldExceed(entitlement.limits.aiRunsPerMonth, entitlement.metered, counter.aiRuns - weight, weight);
  const overWords = cap !== null && counter.autowriteWords > cap;
  if (overRuns || overWords) {
    await prisma.usageCounter.update({
      where: { userId_period: { userId: user.id, period } },
      data: { aiRuns: { decrement: weight }, autowriteWords: { decrement: targetWords } },
    });
    if (overWords) throw new AutowriteCapError(entitlement, (cap as number) - (counter.autowriteWords - targetWords));
    throw new AiLimitError({ ...entitlement, usage: { ...entitlement.usage, aiRuns: counter.aiRuns - weight } });
  }
  await maybeSendAllowanceNudge(
    user.id,
    user.email,
    { ...entitlement, usage: { ...entitlement.usage, aiRuns: counter.aiRuns, autowriteWords: counter.autowriteWords } },
    publicOrigin("")
  ).catch((error) => console.error("allowance nudge failed", error));
}

/** Give back allowance units (default 1) that failed before the author got anything from it. */
export async function refundAiRun(user: PublicUser | null, weight = 1): Promise<void> {
  if (!user || !authRequired()) return;
  await prisma.usageCounter
    .updateMany({
      where: { userId: user.id, period: usagePeriod(), aiRuns: { gte: weight } },
      data: { aiRuns: { decrement: weight } },
    })
    .catch(() => {});
}

/**
 * Meter `weight` allowance units (default 1) around `run`: charged up front
 * (throwing AiLimitError when the allowance is gone) and refunded if `run`
 * throws.
 */
export async function withAiRun<T>(user: PublicUser | null, run: () => Promise<T>, weight = 1): Promise<T> {
  await meterAiRun(user, weight);
  try {
    return await run();
  } catch (error) {
    await refundAiRun(user, weight);
    throw error;
  }
}
