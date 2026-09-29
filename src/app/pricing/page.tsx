import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import BrandMark from "@/components/BrandMark";
import BackLink from "@/app/privacy/BackLink";
import { getSessionUser } from "@/lib/auth/session";
import { authRequired } from "@/lib/auth/constants";
import { planLimits, stripeSettings } from "@/lib/billing/config";
import { getStripe } from "@/lib/billing/stripe";
import { proPrices } from "@/lib/billing/prices";
import { getEntitlement } from "@/lib/entitlements";
import PricingPlans from "./PricingPlans";
import "../privacy/privacy.css";
import "./pricing.css";

export const metadata: Metadata = {
  title: "Pricing - Ciciro",
  description: "Ciciro is free to write in. Ciciro Pro adds more of the AI editor every month.",
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
  const home = user || !authRequired() ? "/" : "/launch";

  return (
    <main className="privacy-page pricing-page">
      <header className="privacy-header">
        <Link href={home} className="privacy-brand">
          <BrandMark size={24} />
          <span className="privacy-wordmark">Ciciro</span>
        </Link>
        <BackLink fallback={home} />
      </header>

      <div className="pricing-body">
        <p className="privacy-eyebrow">Pricing</p>
        <h1 className="privacy-title">Write for free. Go further with Ciciro Pro.</h1>
        <p className="pricing-lede">
          Your manuscripts, story bible, exports and sync are free, always. Plans only change how
          much of the AI editor you can use each month.
        </p>

        <PricingPlans
          signedIn={Boolean(user)}
          entitlement={entitlement}
          prices={prices}
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
