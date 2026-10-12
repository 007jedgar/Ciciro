import { ScrollView, Text, View } from "react-native";
import { Redirect } from "expo-router";
import { useTranslation } from "react-i18next";
import { AppHeader, useMeasuredAppHeaderHeight } from "../components/AppHeader";
import { PrivacyChoices } from "../components/PrivacyChoices";
import { sweepLegacyAnalyticsIdentity } from "../lib/analytics-client";
import { decideConsent, useConsent, type ConsentCategories } from "../lib/consent";
import { billingDate } from "../lib/billing";
import { currentLocale } from "../lib/i18n";
import { useSession } from "../lib/session";
import { useAppTheme } from "../lib/settings";
import { useStackBack } from "../lib/use-stack-back";

/**
 * "Privacy choices": the persistent entry point for changing the device's
 * analytics consent decision, reachable anytime from Settings. Shows the
 * current, versioned decision and when it was made (so withdrawal is as
 * informed as consenting), then shares the decision UI with the auto-shown
 * ConsentGate sheet - see docs/analytics.md.
 */
export default function PrivacyChoicesScreen() {
  const { t } = useTranslation();
  const { backOr } = useStackBack();
  const { user, ready } = useSession();
  const { settings, patch, layout, colors } = useAppTheme();
  const consent = useConsent();
  const [headerHeight, onHeaderHeight] = useMeasuredAppHeaderHeight();

  if (!ready) return null;
  if (!user) return <Redirect href="/login" />;

  function decide(categories: ConsentCategories) {
    if (!categories.analytics) sweepLegacyAnalyticsIdentity();
    decideConsent(categories);
    if (settings.analyticsEnabled !== categories.analytics) patch({ analyticsEnabled: categories.analytics });
    backOr("/settings");
  }

  const statusKey = consent
    ? consent.categories.analytics
      ? "consent.statusAllowed"
      : "consent.statusNotAllowed"
    : "consent.statusUndecided";
  const status = consent
    ? t(statusKey, { date: billingDate(consent.decidedAt, currentLocale()) })
    : t(statusKey);

  return (
    <View style={layout.screen}>
      <AppHeader
        title={t("settings.privacyChoices")}
        onBack={() => backOr("/settings")}
        floating
        onHeightChange={onHeaderHeight}
      />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: headerHeight + 8, paddingBottom: 40 }}
        scrollIndicatorInsets={{ top: headerHeight }}
      >
        <Text style={{ marginBottom: 18, fontSize: 14, lineHeight: 20, color: colors.inkSoft }}>{status}</Text>
        <PrivacyChoices
          analyticsEnabled={consent?.categories.analytics ?? settings.analyticsEnabled}
          onDecide={decide}
          colors={colors}
        />
      </ScrollView>
    </View>
  );
}
