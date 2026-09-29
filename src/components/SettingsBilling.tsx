"use client";

import { useState } from "react";
import Link from "next/link";
import {
  allowanceResetsOn,
  billingDate,
  openBillingPortal,
  storeName,
  type Entitlement,
} from "@/lib/billing-client";

/**
 * The Settings popover's plan section: the plan, this month's AI use, and the
 * one next step (upgrade, manage on the web, or manage in the store). Hidden
 * when there is nothing to show: no metering and nothing for sale.
 */
export default function SettingsBilling({ entitlement }: { entitlement: Entitlement }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cap = entitlement.limits.aiRunsPerMonth;
  const paid = entitlement.plan !== "free";
  const store = storeName(entitlement.source);
  if (!paid && cap === null && !entitlement.billing.web) return null;

  async function manage() {
    setBusy(true);
    setError(null);
    const result = await openBillingPortal();
    if ("url" in result) {
      window.location.assign(result.url);
      return;
    }
    setError(result.error);
    setBusy(false);
  }

  const used = Math.min(entitlement.usage.aiRuns, cap ?? entitlement.usage.aiRuns);
  const fill = cap ? Math.min(100, (entitlement.usage.aiRuns / cap) * 100) : 0;

  return (
    <>
      <div className="theme-menu-label">Plan</div>
      <div className="settings-row">
        <span>{entitlement.planName}</span>
        {paid && entitlement.currentPeriodEnd ? (
          <span className="settings-model">
            {entitlement.cancelAtPeriodEnd ? "Ends" : "Renews"} {billingDate(entitlement.currentPeriodEnd)}
          </span>
        ) : null}
      </div>
      {cap !== null ? (
        <div className="settings-usage">
          <div className={`settings-usage-bar ${fill >= 100 ? "full" : ""}`} aria-hidden="true">
            <span style={{ width: `${fill}%` }} />
          </div>
          <p className="settings-hint">
            {used.toLocaleString("en-US")} of {cap.toLocaleString("en-US")} AI actions this month ·{" "}
            <span className="nowrap">resets {allowanceResetsOn(entitlement.usage.period, "short")}</span>
          </p>
        </div>
      ) : null}
      {paid && store ? (
        <>
          <p className="settings-hint">Billed through {store}. Change or cancel it there.</p>
          {entitlement.manageUrl ? (
            <a className="settings-action" href={entitlement.manageUrl} target="_blank" rel="noreferrer">
              Manage subscription
            </a>
          ) : null}
        </>
      ) : null}
      {paid && entitlement.source === "stripe" ? (
        <button type="button" className="settings-action" onClick={manage} disabled={busy}>
          {busy ? "Opening…" : "Manage billing"}
        </button>
      ) : null}
      {!paid && entitlement.billing.web ? (
        <Link className="settings-action accent" href="/pricing">
          Upgrade to Ciciro Pro
        </Link>
      ) : null}
      {error ? (
        <p className="settings-hint settings-error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
