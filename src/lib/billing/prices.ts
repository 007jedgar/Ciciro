import type Stripe from "stripe";
import type { BillingInterval, StripeSettings } from "@/lib/billing/config";

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
