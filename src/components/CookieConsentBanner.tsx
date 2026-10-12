"use client";

import Presence from "@/components/Presence";
import { MOTION_MS } from "@/lib/motion";
import { useConsent } from "@/components/ConsentProvider";

/**
 * The first-layer cookie banner: equal-weight Accept all / Reject all, plus
 * Customize to open the full preference center (CookiePreferencesDialog).
 * Shown to every visitor, signed in or not, until a current-version decision
 * exists for this device - see docs/analytics.md's "Opt-in consent" bullet. Non-blocking: it
 * never covers the page or stops anything from working.
 */
export default function CookieConsentBanner() {
  const { decided, acceptAll, rejectAll, openPreferences } = useConsent();
  return (
    <Presence open={!decided} exitMs={MOTION_MS.dialogOut}>
      <div
        className="cookie-banner"
        role="region"
        aria-label="Cookie consent"
      >
        <p className="cookie-banner-text">
          Ciciro uses necessary cookies to run the site, and asks before anything else. Product
          analytics (PostHog) stays off until you say yes.{" "}
          <a href="/privacy#cookies">Learn more</a>.
        </p>
        <div className="cookie-banner-actions">
          <button type="button" className="btn" onClick={openPreferences}>
            Customize
          </button>
          <button type="button" className="btn" onClick={rejectAll}>
            Reject all
          </button>
          <button type="button" className="btn primary" onClick={acceptAll}>
            Accept all
          </button>
        </div>
      </div>
    </Presence>
  );
}
