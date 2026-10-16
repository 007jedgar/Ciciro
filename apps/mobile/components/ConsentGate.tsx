import { useState } from "react";
import { usePathname } from "expo-router";
import { useTranslation } from "react-i18next";
import { GlassSheet } from "./GlassSheet";
import { PrivacyChoices } from "./PrivacyChoices";
import { decideConsent, needsConsentPrompt, useConsent, type ConsentCategories } from "../lib/consent";
import { useConsentMode } from "../lib/consent-region-store";
import { sweepLegacyAnalyticsIdentity } from "../lib/analytics-client";
import { useAppTheme } from "../lib/settings";
import { useSession } from "../lib/session";

/**
 * The analytics consent prompt, shown once, and only where asking first is
 * required (the EU / EEA / UK / Switzerland, California, Washington and
 * Oregon, and anywhere we cannot tell: lib/consent-region.ts). Elsewhere in
 * the US analytics is on by default and Settings > Privacy choices is the way
 * out, so nothing is shown. It waits for the location lookup (cached after
 * the first) rather than flash for someone it turns out not to apply to.
 * Shown right after a brand-new account
 * finishes signup (never blocking the signup form itself), and for an
 * existing install on its first launch after updating to a version with no
 * current-version consent record (see docs/analytics.md and AGENTS.md's
 * consent notes). Suppressed on the pre-signup onboarding quiz routes,
 * which have no account yet to write the decision through to - an account
 * created there, or by skipping straight to signup, is prompted here the
 * moment it lands in the signed-in app. Swiping it away (or Android back)
 * leaves nothing decided and it reappears next launch; "Privacy choices" in
 * Settings reopens the same choice anytime.
 */
export function ConsentGate() {
  const { t } = useTranslation();
  const { ready, user } = useSession();
  const { settings, patch, colors } = useAppTheme();
  const consent = useConsent();
  const pathname = usePathname();
  const { mode, known, settled } = useConsentMode();
  const [dismissed, setDismissed] = useState(false);

  const visible =
    ready &&
    !!user &&
    !pathname.startsWith("/onboarding") &&
    (known || settled) &&
    needsConsentPrompt(consent, mode) &&
    !dismissed;

  function decide(categories: ConsentCategories) {
    if (!categories.analytics) sweepLegacyAnalyticsIdentity();
    decideConsent(categories);
    if (settings.analyticsEnabled !== categories.analytics) patch({ analyticsEnabled: categories.analytics });
    setDismissed(true);
  }

  return (
    <GlassSheet visible={visible} onClose={() => setDismissed(true)} title={t("consent.title")}>
      <PrivacyChoices analyticsEnabled={false} onDecide={decide} colors={colors} />
    </GlassSheet>
  );
}
