import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import BrandMark from "@/components/BrandMark";
import BackLink from "@/app/privacy/BackLink";
import { getSessionUser } from "@/lib/auth/session";
import { openEarlyAccess, planLimits, stripeSettings } from "@/lib/billing/config";
import { earlyAccessApplies, getStripe } from "@/lib/billing/stripe";
import { earlyAccessOffer, proPrices } from "@/lib/billing/prices";
import { getEntitlement } from "@/lib/entitlements";
import PricingPlans from "./PricingPlans";
import "../privacy/privacy.css";
import "./pricing.css";

export const metadata: Metadata = {
  title: "Pricing - Ciciro",
  description:
    "Ciciro is free to write in. Ciciro Pro adds more of the AI editor every month, and early-access writers get a founding discount.",
};

export const dynamic = "force-dynamic";

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  // No Stripe, nothing to sell on the web: the page does not exist.
  const settings = stripeSettings();
  const stripe = getStripe(settings);
  if (!settings || !stripe) notFound();

  const [{ checkout }, user, prices] = await Promise.all([
    searchParams,
    getSessionUser().catch(() => null),
    proPrices(stripe, settings),
  ]);
  const entitlement = user ? await getEntitlement(user.id) : null;
  // The offer as the coupon describes it, shown to anyone Checkout would give
  // it to: signed out (a new account qualifies) or never subscribed before.
  const open = openEarlyAccess();
  const eligible = open && (!user || (await earlyAccessApplies(user.id)) !== null);
  const offer = eligible ? await earlyAccessOffer(stripe, open, prices) : null;

  return (
    <main className="privacy-page pricing-page">
      <header className="privacy-header">
        <Link href="/" className="privacy-brand">
          <BrandMark size={24} />
          <span className="privacy-wordmark">Ciciro</span>
        </Link>
        <BackLink fallback="/" />
      </header>

      <div className="pricing-body">
        <p className="privacy-eyebrow">Pricing{open ? " / Early access" : ""}</p>
        <h1 className="privacy-title pricing-title">
          Free to write in. <em>Pro</em> when you want more of Ciciro.
        </h1>
        <p className="pricing-lede">
          Your manuscripts, story bible, reminders, exports and sync are free, always. Plans only
          change how much of the AI editor you can use each month.
        </p>

        <PricingPlans
          signedIn={Boolean(user)}
          entitlement={entitlement}
          prices={prices}
          offer={offer}
          limits={{ free: planLimits("free").aiRunsPerMonth, pro: planLimits("pro").aiRunsPerMonth }}
          justSubscribed={checkout === "success"}
        />

        <section className="pricing-notes">
          <p>
            An <strong>AI action</strong> is one message to Ciciro, one autowrite run, one
            continuity check, style analysis, weekly review or set of ideas. Spelling suggestions,
            chapter summaries and recaps don&apos;t count, and keep working until the month&apos;s
            actions are used.
          </p>
          {offer ? (
            <p>
              The <strong>early-access price</strong> is for your first Ciciro Pro subscription,
              on the web or in the apps, started while early access is open. It is applied at
              checkout, and once it ends Pro renews at the list price shown above.
            </p>
          ) : null}
          <p>
            Ciciro Pro renews automatically every month or year until you cancel. Cancel any time
            from Settings, under Manage billing; you keep Pro until the end of the period you paid
            for. Taxes are worked out at checkout. If you subscribed in the iPhone or Android app,
            manage it in the App Store or Google Play instead.
          </p>
          <p>
            <Link href="/terms">Terms of Use</Link> · <Link href="/privacy">Privacy</Link>
          </p>
        </section>
      </div>
    </main>
  );
}
