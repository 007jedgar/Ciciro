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
import type { DisplayPrice } from "@/lib/billing/prices";

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

export default function PricingPlans({
  signedIn,
  entitlement: initial,
  prices,
  limits,
  justSubscribed,
}: {
  signedIn: boolean;
  entitlement: Entitlement | null;
  prices: Partial<Record<Interval, DisplayPrice>>;
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
        {busy ? "Opening checkout…" : "Upgrade to Ciciro Pro"}
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
            {price ? price.label : "—"}
            <span>{interval === "month" ? " / month" : " / year"}</span>
          </p>
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
