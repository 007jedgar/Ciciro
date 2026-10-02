"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import Presence from "@/components/Presence";
import { MOTION_MS } from "@/lib/motion";
import { AI_LIMIT_EVENT, allowanceResetsOn, type AiLimitDetail } from "@/lib/billing-client";
import { getAnalytics } from "@/lib/analytics-client";

/**
 * The limit-reached state, app-wide: any AI request that comes back 402
 * raises AI_LIMIT_EVENT (reportAiLimit), and this says what happened, when
 * the allowance starts over, and where to upgrade when the web sells Pro.
 */
export default function AiLimitDialog() {
  const [detail, setDetail] = useState<AiLimitDetail | null>(null);
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function onLimit(event: Event) {
      setDetail((event as CustomEvent<AiLimitDetail>).detail);
      setOpen(true);
      getAnalytics().track("paywall_viewed", { surface: "ai_limit_dialog" });
    }
    window.addEventListener(AI_LIMIT_EVENT, onLimit);
    return () => window.removeEventListener(AI_LIMIT_EVENT, onLimit);
  }, []);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // Claim the key so focus mode, which listens on window, does not also exit.
      e.stopPropagation();
      setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (typeof document === "undefined") return null;
  const entitlement = detail?.entitlement ?? null;
  const cap = entitlement?.limits.aiRunsPerMonth ?? null;
  const canUpgrade = entitlement?.plan === "free" && entitlement.billing.web;

  return createPortal(
    <Presence open={open} exitMs={MOTION_MS.dialogOut}>
      <div className="drawer-overlay" onClick={() => setOpen(false)} />
      <div
        className="account-dialog ai-limit-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="ai-limit-title"
        aria-describedby="ai-limit-body"
      >
        <h2 id="ai-limit-title">{detail?.message ?? "You've used this month's AI allowance."}</h2>
        <div id="ai-limit-body">
          {entitlement && cap !== null ? (
            <div className="ai-limit-meter" aria-hidden="true">
              <span style={{ width: "100%" }} />
            </div>
          ) : null}
          {entitlement && cap !== null ? (
            <p className="ai-limit-count">
              {Math.min(entitlement.usage.aiRuns, cap).toLocaleString("en-US")} of {cap.toLocaleString("en-US")} AI
              actions used. Your allowance starts over on{" "}
              {allowanceResetsOn(entitlement.usage.period)}.
            </p>
          ) : null}
          <p>
            Your manuscript, notes and story bible stay fully editable; chat, drafting and checks
            pause until then.
            {canUpgrade ? " Ciciro Pro brings them back now, with a much larger monthly allowance." : ""}
          </p>
        </div>
        <div className="account-dialog-actions">
          <button ref={closeRef} type="button" className="btn" onClick={() => setOpen(false)}>
            {canUpgrade ? "Not now" : "OK"}
          </button>
          {canUpgrade ? (
            <Link
              className="btn primary"
              href="/pricing"
              onClick={() => {
                getAnalytics().track("paywall_cta_clicked", { surface: "ai_limit_dialog", plan: "pro" });
                setOpen(false);
              }}
            >
              See Ciciro Pro
            </Link>
          ) : null}
        </div>
      </div>
    </Presence>,
    document.body
  );
}
