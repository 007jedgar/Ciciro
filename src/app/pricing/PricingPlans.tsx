"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  billingDate,
  fetchEntitlement,
  openBillingPortal,
  startCheckout,
  storeName,
  type Entitlement,
} from "@/lib/billing-client";
import { offerHeadline, offerTerm, type DisplayOffer, type DisplayPrice } from "@/lib/billing/prices";

type Interval = "month" | "year";

const SIGNUP = "/signup?next=%2Fpricing";

function allowance(cap: number | null): string {
  return cap === null ? "Unlimited AI actions" : `${cap.toLocaleString("en-US")} AI actions a month`;
}

/** Whole percent a year saves against twelve months, or null when it doesn't. */
function yearlySaving(prices: Partial<Record<Interval, DisplayPrice>>): number | null {
  const month = prices.month;
  const year = prices.year;
  if (!month || !year || month.currency !== year.currency) return null;
  const saving = Math.round((1 - year.amount / (month.amount * 12)) * 100);
  return saving > 0 ? saving : null;
}

/** "$6 a month or $48 for your first year": what the offer costs, per interval. */
function offerPrices(offer: DisplayOffer): string {
  const parts: string[] = [];
  if (offer.prices.month) parts.push(`${offer.prices.month.label} a month`);
  if (offer.prices.year) parts.push(`${offer.prices.year.label} for the year`);
  return parts.join(" or ");
}

/** "$12 a month or $96 a year": the list prices the offer renews at. */
function listPrices(prices: Partial<Record<Interval, DisplayPrice>>): string {
  const parts: string[] = [];
  if (prices.month) parts.push(`${prices.month.label} a month`);
  if (prices.year) parts.push(`${prices.year.label} a year`);
  return parts.join(" or ");
}

function EarlyAccess({
  offer,
  prices,
  interval,
}: {
  offer: DisplayOffer;
  prices: Partial<Record<Interval, DisplayPrice>>;
  interval: Interval;
}) {
  const head = offerHeadline(offer);
  const term = offerTerm(offer, interval);
  const title = offer.duration === "forever" ? `${head} Ciciro Pro ${term}.` : `${head} ${term} of Ciciro Pro.`;
  const until = offer.endsAt ? `until ${billingDate(offer.endsAt)}` : "while early access lasts";
  return (
    <aside className="pricing-offer" aria-labelledby="pricing-offer-title">
      <div className="pricing-offer-copy">
        <p className="pricing-offer-kicker">Early access / Founding writers</p>
        <h2 id="pricing-offer-title">{title}</h2>
        <p>
          {offerPrices(offer)}, then {listPrices(prices)}. A thank-you for writing with Ciciro
          this early: one per account, on the web or in the apps, {until}.
        </p>
      </div>
      <span className="pricing-offer-stamp" aria-hidden>
        <b>{offer.percentOff}%</b>
        <span>off</span>
      </span>
    </aside>
  );
}

export default function PricingPlans({
  signedIn,
  entitlement: initial,
  prices,
  offer,
  limits,
  justSubscribed,
}: {
  signedIn: boolean;
  entitlement: Entitlement | null;
  prices: Partial<Record<Interval, DisplayPrice>>;
  offer: DisplayOffer | null;
  limits: { free: number | null; pro: number | null };
  justSubscribed: boolean;
}) {
  const [entitlement, setEntitlement] = useState(initial);
  const [interval, setBillingInterval] = useState<Interval>(
    initial?.interval ?? (prices.year && !prices.month ? "year" : "month")
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ error: string; manageUrl?: string | null } | null>(null);
  const [waiting, setWaiting] = useState(justSubscribed && initial?.plan === "free");

  // Back from Checkout before Stripe's webhook landed: watch for Pro to turn on.
  useEffect(() => {
    if (!waiting) return;
    let tries = 0;
    const timer = window.setInterval(async () => {
      tries += 1;
      const next = await fetchEntitlement().catch(() => null);
      if (next) setEntitlement(next);
      if (next?.plan === "pro" || tries >= 15) {
        window.clearInterval(timer);
        setWaiting(false);
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [waiting]);

  const plan = entitlement?.plan ?? null;
  const price = prices[interval];
  const saving = yearlySaving(prices);
  const store = storeName(entitlement?.source ?? null);
  // Never offer the early-access price to someone already on Pro.
  const deal = plan === "pro" ? null : offer;
  const dealPrice = deal?.prices[interval] ?? null;

  async function go(action: () => ReturnType<typeof startCheckout>) {
    setBusy(true);
    setProblem(null);
    const result = await action();
    if ("url" in result) {
      window.location.assign(result.url);
      return;
    }
    setProblem(result);
    setBusy(false);
  }

  let proAction;
  if (!signedIn) {
    proAction = (
      <Link className="btn primary pricing-cta" href={SIGNUP}>
        Create an account to subscribe
      </Link>
    );
  } else if (plan === "pro" && entitlement?.source === "stripe") {
    proAction = (
      <button type="button" className="btn pricing-cta" disabled={busy} onClick={() => go(openBillingPortal)}>
        {busy ? "Opening…" : "Manage billing"}
      </button>
    );
  } else if (plan === "pro" && store) {
    proAction = entitlement?.manageUrl ? (
      <a className="btn pricing-cta" href={entitlement.manageUrl} target="_blank" rel="noreferrer">
        Manage in {store}
      </a>
    ) : null;
  } else {
    proAction = (
      <button
        type="button"
        className="btn primary pricing-cta"
        disabled={busy || !price}
        onClick={() => go(() => startCheckout(interval))}
      >
        {busy ? "Opening checkout…" : dealPrice ? "Upgrade at the early-access price" : "Upgrade to Ciciro Pro"}
      </button>
    );
  }

  return (
    <>
      {justSubscribed && plan === "pro" ? (
        <div className="pricing-banner" role="status">
          <strong>Welcome to Ciciro Pro.</strong> Your new allowance is ready in the editor.
        </div>
      ) : waiting ? (
        <div className="pricing-banner" role="status">
          Finishing your subscription with Stripe…
        </div>
      ) : null}

      {deal ? <EarlyAccess offer={deal} prices={prices} interval={interval} /> : null}

      {prices.month && prices.year && plan !== "pro" ? (
        <div className="pricing-toggle" role="radiogroup" aria-label="Billing period">
          {(["month", "year"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={interval === option}
              className={interval === option ? "active" : ""}
              onClick={() => setBillingInterval(option)}
            >
              {option === "month" ? "Monthly" : "Yearly"}
              {option === "year" && saving ? <span className="pricing-save">Save {saving}%</span> : null}
            </button>
          ))}
        </div>
      ) : null}

      <div className="pricing-plans">
        <section className={`pricing-plan ${plan === "free" ? "current" : ""}`} aria-labelledby="plan-free">
          <div className="pricing-plan-head">
            <h2 id="plan-free">Free</h2>
            {plan === "free" ? <span className="pricing-badge">Your plan</span> : null}
          </div>
          <p className="pricing-price">
            $0<span> forever</span>
          </p>
          <ul>
            <li>The whole editor, story bible and outline</li>
            <li>Word, Markdown, EPUB and PDF export, and your data any time</li>
            <li>Sync across the web, iPhone and Android</li>
            <li>{allowance(limits.free)} with Ciciro</li>
          </ul>
          {!signedIn ? (
            <Link className="btn pricing-cta" href={SIGNUP}>
              Start writing free
            </Link>
          ) : null}
        </section>

        <section className={`pricing-plan pro ${plan === "pro" ? "current" : ""}`} aria-labelledby="plan-pro">
          <div className="pricing-plan-head">
            <h2 id="plan-pro">Ciciro Pro</h2>
            {plan === "pro" ? <span className="pricing-badge">Your plan</span> : null}
          </div>
          <p className="pricing-price">
            {dealPrice && price ? (
              <>
                <s aria-label={`was ${price.label}`}>{price.label}</s> {dealPrice.label}
              </>
            ) : price ? (
              price.label
            ) : (
              "—"
            )}
            <span>{interval === "month" ? " / month" : " / year"}</span>
          </p>
          {deal && dealPrice && price ? (
            <p className="pricing-offer-term">
              Early access, {offerTerm(deal, interval)}. Then {price.label} a {interval}.
            </p>
          ) : null}
          <ul>
            <li>Everything in Free</li>
            <li>{allowance(limits.pro)} with Ciciro</li>
            <li>Chat, autowrite, continuity checks, style analysis and weekly reviews</li>
            <li>One subscription for the web and the apps</li>
          </ul>
          {plan === "pro" && entitlement?.currentPeriodEnd ? (
            <p className="pricing-status">
              {store ? `Billed through ${store}. ` : ""}
              {entitlement.cancelAtPeriodEnd ? "Ends" : "Renews"} {billingDate(entitlement.currentPeriodEnd)}.
            </p>
          ) : null}
          {proAction}
          {problem ? (
            <p className="pricing-error" role="alert">
              {problem.error}
              {problem.manageUrl ? (
                <>
                  {" "}
                  <a href={problem.manageUrl} target="_blank" rel="noreferrer">
                    Manage subscription
                  </a>
                </>
              ) : null}
            </p>
          ) : null}
        </section>
      </div>
    </>
  );
}
