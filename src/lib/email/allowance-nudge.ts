import { prisma } from "@/lib/db";
import type { Entitlement } from "@/lib/entitlements";
import { sendMarketingEmail } from "@/lib/email/marketing-send";
import { allowanceNudgeTemplate } from "@/lib/email/templates";
import { openEarlyAccess, stripeSettings } from "@/lib/billing/config";
import { earlyAccessApplies, getStripe } from "@/lib/billing/stripe";
import { earlyAccessOffer, offerHeadline, offerTerm, proPrices } from "@/lib/billing/prices";

const NUDGE_THRESHOLD = 0.8;

/** "Half price for your first year", when this user still qualifies for the open offer. */
async function earlyAccessHeadline(userId: string): Promise<string | undefined> {
  const settings = stripeSettings();
  const open = openEarlyAccess();
  const stripe = getStripe(settings);
  if (!settings || !open || !stripe) return undefined;
  if (!(await earlyAccessApplies(userId))) return undefined;
  const prices = await proPrices(stripe, settings);
  const offer = await earlyAccessOffer(stripe, open, prices);
  if (!offer) return undefined;
  return `${offerHeadline(offer)} ${offerTerm(offer, "year")}`;
}

/**
 * Called from entitlements.ts's meterAiRun right after an AI action lands:
 * once a free-plan account crosses 80% of this month's allowance, nudge it
 * toward Pro. Idempotent per usage period via MarketingEmailLog, so a busy
 * day of AI runs still sends only one.
 */
export async function maybeSendAllowanceNudge(
  userId: string,
  email: string,
  entitlement: Entitlement,
  origin: string
): Promise<void> {
  if (entitlement.plan !== "free" || !entitlement.metered) return;
  const cap = entitlement.limits.aiRunsPerMonth;
  if (!cap || entitlement.usage.aiRuns / cap < NUDGE_THRESHOLD) return;

  const key = `allowance-nudge:${entitlement.usage.period}`;
  const alreadyClaimed = await prisma.marketingEmailLog.findUnique({
    where: { userId_key: { userId, key } },
    select: { id: true },
  });
  if (alreadyClaimed) return;

  const headline = await earlyAccessHeadline(userId);
  await sendMarketingEmail({
    userId,
    email,
    topic: "offers",
    key,
    origin,
    buildContent: (unsubscribe) => ({
      ...allowanceNudgeTemplate({
        planName: "Ciciro Pro",
        percentUsed: Math.floor((entitlement.usage.aiRuns / cap) * 100),
        pricingUrl: `${origin}/pricing`,
        earlyAccessHeadline: headline,
      }),
      unsubscribe,
    }),
  });
}
