import { useState } from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { PressableCard } from "../components/PressableCard";
import { ThemeCard } from "../components/ThemeCard";
import { OnboardingFrame, Rise } from "../components/onboarding/OnboardingFrame";
import { useAppTheme } from "../lib/settings";
import { useStackBack } from "../lib/use-stack-back";
import { getAnalytics } from "../lib/analytics-client";
import { onboardingParams, parseOnboardingParams, stepsFor } from "../lib/onboarding-flow";
import { THEME_META, type ThemeId } from "../lib/theme";
import { useThemePreview } from "../lib/theme-preview-context";
import { useThemeChange } from "../lib/use-theme-change";

const COLUMNS = 2;

/**
 * The "Pick a look" step between the quiz and the demo. Tapping a theme washes
 * the whole app into it; the choice is only previewed (see
 * lib/theme-preview-context.ts) and is saved only if this turns into a brand-new
 * account, so nobody's existing settings are overwritten from here.
 */
export default function OnboardingLookScreen() {
  const router = useRouter();
  const { backOr } = useStackBack();
  const { t } = useTranslation();
  const { layout, settings } = useAppTheme();
  const { preview, setPreview } = useThemePreview();
  const changeTheme = useThemeChange();
  const state = parseOnboardingParams(useLocalSearchParams<{ kind?: string; obstacles?: string }>());
  const [picked, setPicked] = useState<ThemeId | null>(preview);
  const shown = picked ?? settings.theme;

  function pick(theme: ThemeId, event: Parameters<typeof changeTheme>[1]) {
    if (theme === shown) return;
    if (!changeTheme(() => setPreview(theme), event)) return;
    setPicked(theme);
    getAnalytics().track("onboarding_theme_selected", { theme });
  }

  function next() {
    router.push({
      pathname: "/onboarding-demo",
      params: onboardingParams(state),
    });
  }

  function skip() {
    getAnalytics().track("onboarding_skipped", { step: "theme" });
    router.push({ pathname: "/signup", params: onboardingParams(state) });
  }

  const rows: (typeof THEME_META)[] = [];
  for (let i = 0; i < THEME_META.length; i += COLUMNS) rows.push(THEME_META.slice(i, i + COLUMNS));

  return (
    <OnboardingFrame
      steps={stepsFor(state.obstacles)}
      step="look"
      title={t("onboarding.lookTitle")}
      body={t("onboarding.lookBody")}
      onBack={() => backOr("/")}
      onSkip={skip}
      footer={
        <PressableCard
          accent
          onPress={next}
          accessibilityRole="button"
          accessibilityLabel={t("onboarding.continue")}
          style={[layout.primaryBtn, { marginTop: 0 }]}
        >
          <Text style={layout.primaryBtnText}>{t("onboarding.continue")}</Text>
        </PressableCard>
      }
    >
      <View accessibilityRole="radiogroup" style={{ gap: 10 }}>
        {rows.map((row, r) => (
          <Rise key={row[0]!.id} index={r + 2} style={{ flexDirection: "row", gap: 10 }}>
            {row.map((meta) => (
              <ThemeCard
                key={meta.id}
                theme={meta.id}
                selected={shown === meta.id}
                onPress={(event) => pick(meta.id, event)}
              />
            ))}
          </Rise>
        ))}
      </View>
    </OnboardingFrame>
  );
}
