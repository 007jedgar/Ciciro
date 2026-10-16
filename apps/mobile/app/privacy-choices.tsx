import { Linking, ScrollView, Switch, Text, View } from "react-native";
import { Redirect } from "expo-router";
import { useTranslation } from "react-i18next";
import { AppHeader, useMeasuredAppHeaderHeight } from "../components/AppHeader";
import { Group } from "../components/SettingsParts";
import { TapPressable } from "../components/TapPressable";
import { API_URL } from "../lib/api";
import { sweepLegacyAnalyticsIdentity } from "../lib/analytics-client";
import { billingDate } from "../lib/billing";
import { decideConsent, useConsent } from "../lib/consent";
import { useConsentMode } from "../lib/consent-region-store";
import { currentLocale } from "../lib/i18n";
import * as haptics from "../lib/haptics";
import { useSession } from "../lib/session";
import { useAppTheme } from "../lib/settings";
import { switchColors } from "../lib/switch-theme";
import { useAnalyticsAllowed } from "../lib/use-analytics-allowed";
import { useStackBack } from "../lib/use-stack-back";

/**
 * "Privacy choices": a switch for analytics, reachable anytime from Settings
 * and available to everyone, whether or not they were asked at the prompt
 * (lib/consent-region.ts decides who is). It shows what is true right now and
 * changes it on the spot: AnalyticsSync reacts to the new decision at once.
 * Turning it off here, or on, is recorded like a choice at the prompt (the
 * versioned device record, written through to the account's
 * `analyticsEnabled`), so a later launch never asks again. See
 * docs/analytics.md.
 */
export default function PrivacyChoicesScreen() {
  const { t } = useTranslation();
  const { backOr } = useStackBack();
  const { user, ready } = useSession();
  const { settings, patch, layout, colors } = useAppTheme();
  const consent = useConsent();
  const { mode } = useConsentMode();
  const allowed = useAnalyticsAllowed();
  const [headerHeight, onHeaderHeight] = useMeasuredAppHeaderHeight();

  if (!ready) return null;
  if (!user) return <Redirect href="/login" />;

  function toggle(next: boolean) {
    if (!next) sweepLegacyAnalyticsIdentity();
    decideConsent({ analytics: next });
    if (settings.analyticsEnabled !== next) patch({ analyticsEnabled: next });
  }

  let status: string;
  if (consent && consent.categories.analytics === allowed) {
    status = t(allowed ? "consent.statusAllowed" : "consent.statusNotAllowed", {
      date: billingDate(consent.decidedAt, currentLocale()),
    });
  } else if (consent?.categories.analytics) {
    // This device said yes, but the account says no (another device turned it off).
    status = t("consent.statusAccountOff");
  } else if (!consent && mode === "opt-out") {
    status = t(settings.analyticsEnabled ? "consent.statusDefaultOn" : "consent.statusAccountOff");
  } else {
    status = t("consent.statusUndecided");
  }

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
        <Group colors={colors}>
          <View
            style={{
              minHeight: 64,
              paddingHorizontal: 16,
              paddingVertical: 14,
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
            }}
          >
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text style={{ fontSize: 17, color: colors.ink }}>{t("consent.analyticsTitle")}</Text>
              <Text style={{ marginTop: 3, fontSize: 13, lineHeight: 18, color: colors.inkSoft }}>
                {t("consent.analyticsDesc")}
              </Text>
            </View>
            <Switch
              value={allowed}
              onValueChange={haptics.withTap(toggle)}
              {...switchColors(colors)}
              accessibilityLabel={t("consent.analyticsTitle")}
              accessibilityHint={t("consent.analyticsDesc")}
            />
          </View>
        </Group>
        <Text style={{ marginTop: 14, fontSize: 14, lineHeight: 20, color: colors.inkSoft }}>{status}</Text>
        <Text style={{ marginTop: 12, fontSize: 14, lineHeight: 20, color: colors.inkSoft }}>
          {t("consent.promise")}
        </Text>
        <TapPressable
          onPress={() => void Linking.openURL(`${API_URL}/privacy`)}
          accessibilityRole="link"
          accessibilityLabel={t("consent.policy")}
          feedback="dim"
          style={{ marginTop: 16, alignSelf: "flex-start", paddingVertical: 8 }}
        >
          <Text style={{ fontSize: 15, fontWeight: "600", color: colors.accent }}>{t("consent.policy")}</Text>
        </TapPressable>
      </ScrollView>
    </View>
  );
}
