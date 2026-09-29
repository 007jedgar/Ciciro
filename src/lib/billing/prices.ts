import type Stripe from "stripe";
import type { BillingInterval, EarlyAccessSettings, StripeSettings } from "@/lib/billing/config";

// What the pricing page shows for each Pro interval, read from the Stripe
// Price that Checkout will charge, so the page can never disagree with it.

export type DisplayPrice = {
  interval: BillingInterval;
  /** Minor units, e.g. 1200 for $12.00. */
  amount: number;
  currency: string;
  /** "$12" or "$9.50". */
  label: string;
};

export function formatPrice(amount: number, currency: string): string {
  const whole = amount % 100 === 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount / 100);
}

/** The Pro prices by interval; an interval Stripe cannot answer for is left out. */
export async function proPrices(
  stripe: Stripe,
  settings: StripeSettings
): Promise<Partial<Record<BillingInterval, DisplayPrice>>> {
  const out: Partial<Record<BillingInterval, DisplayPrice>> = {};
  await Promise.all(
    (["month", "year"] as const).map(async (interval) => {
      try {
        const price = await stripe.prices.retrieve(settings.prices[interval]);
        if (typeof price.unit_amount !== "number") return;
        out[interval] = {
          interval,
          amount: price.unit_amount,
          currency: price.currency,
          label: formatPrice(price.unit_amount, price.currency),
        };
      } catch (error) {
        console.error(`[billing] could not read the ${interval} price`, error);
      }
    })
  );
  return out;
}

// The early-access offer as the pricing page shows it, read from the Stripe
// coupon Checkout will apply, for the same reason as the prices.

export type DisplayOffer = {
  /** Whole percent off, e.g. 50. */
  percentOff: number;
  /** How long it lasts: "once" is the first bill, a number is months. */
  duration: "once" | "forever" | number;
  /** When early access closes (ISO), or null while it has no end date. */
  endsAt: string | null;
  /** Each Pro price after the discount. */
  prices: Partial<Record<BillingInterval, DisplayPrice>>;
};

/** A price with `percentOff` taken off, rounded to the cent. */
export function discounted(price: DisplayPrice, percentOff: number): DisplayPrice {
  const amount = Math.round((price.amount * (100 - percentOff)) / 100);
  return { ...price, amount, label: formatPrice(amount, price.currency) };
}

/**
 * The offer, or null when the coupon cannot be read or is not a percent-off
 * coupon (the page only knows how to show those).
 */
export async function earlyAccessOffer(
  stripe: Stripe,
  offer: EarlyAccessSettings,
  prices: Partial<Record<BillingInterval, DisplayPrice>>
): Promise<DisplayOffer | null> {
  try {
    const coupon = await stripe.coupons.retrieve(offer.couponId);
    const percentOff = coupon.percent_off;
    if (!coupon.valid || typeof percentOff !== "number" || percentOff <= 0 || percentOff > 100) return null;
    const duration =
      coupon.duration === "repeating" && coupon.duration_in_months
        ? coupon.duration_in_months
        : coupon.duration === "forever"
          ? "forever"
          : "once";
    const out: Partial<Record<BillingInterval, DisplayPrice>> = {};
    for (const interval of ["month", "year"] as const) {
      const price = prices[interval];
      if (price) out[interval] = discounted(price, percentOff);
    }
    return { percentOff, duration, endsAt: offer.endsAt?.toISOString() ?? null, prices: out };
  } catch (error) {
    console.error("[billing] could not read the early-access coupon", error);
    return null;
  }
}

/** "Half price", "Free" or "40% off". */
export function offerHeadline(offer: DisplayOffer): string {
  if (offer.percentOff === 100) return "Free";
  if (offer.percentOff === 50) return "Half price";
  return `${offer.percentOff}% off`;
}

/**
 * How long the offer lasts on `interval` billing, as the coupon applies it:
 * "for your first year", "for your first 3 months", "for as long as you
 * subscribe". A repeating coupon covers every bill that falls in its months,
 * so a yearly plan gets a year per twelve months or part of them.
 */
export function offerTerm(offer: DisplayOffer, interval: BillingInterval): string {
  if (offer.duration === "forever") return "for as long as you subscribe";
  if (offer.duration === "once") return interval === "year" ? "for your first year" : "for your first month";
  if (interval === "year") {
    const years = Math.ceil(offer.duration / 12);
    return years === 1 ? "for your first year" : `for your first ${years} years`;
  }
  if (offer.duration === 12) return "for your first year";
  return offer.duration === 1 ? "for your first month" : `for your first ${offer.duration} months`;
}
