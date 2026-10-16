import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { PressableCard } from "../../components/PressableCard";
import { OnboardingFrame, Rise } from "../../components/onboarding/OnboardingFrame";
import { getAnalytics } from "../../lib/analytics-client";
import { onboardingParams, parseOnboardingParams, pathAfter, stepsFor, type OnboardingParams } from "../../lib/onboarding-flow";
import { useAppTheme } from "../../lib/settings";
import { fonts } from "../../lib/theme";
import { useStackBack } from "../../lib/use-stack-back";
import { EXERCISES, exerciseMinutes } from "../../lib/writing-exercise";

/**
 * Shown after the demo to people who picked creativity or writer's block: the
 * guided writing exercises exist, here is what they are, and where to find them
 * once signed in. It only tells; an exercise needs an account, so nothing here
 * starts one, and nothing is saved or sent anywhere.
 */
export default function OnboardingExercisesScreen() {
  const router = useRouter();
  const { backOr } = useStackBack();
  const { t } = useTranslation();
  const { colors, layout } = useAppTheme();
  const state = parseOnboardingParams(useLocalSearchParams<OnboardingParams>());

  useEffect(() => {
    getAnalytics().track("onboarding_exercises_viewed", {});
  }, []);

  function next() {
    router.push({ pathname: pathAfter("exercises", state.obstacles), params: onboardingParams(state) });
  }

  function skip() {
    getAnalytics().track("onboarding_skipped", { step: "exercises" });
    router.push({ pathname: "/signup", params: onboardingParams(state) });
  }

  return (
    <OnboardingFrame
      steps={stepsFor(state.obstacles)}
      step="exercises"
      title={t("onboarding.exercises.title")}
      body={t("onboarding.exercises.body")}
      onBack={() => backOr("/")}
      onSkip={skip}
      // Pinned with Continue, so where to find the exercises is in view without scrolling the list.
      footer={
        <>
          <Text style={[layout.cardMeta, { textAlign: "center", marginTop: 0, marginBottom: 12 }]}>
            {t("onboarding.exercises.find")}
          </Text>
          <PressableCard
            accent
            onPress={next}
            accessibilityRole="button"
            accessibilityLabel={t("onboarding.continue")}
            style={[layout.primaryBtn, { marginTop: 0 }]}
          >
            <Text style={layout.primaryBtnText}>{t("onboarding.continue")}</Text>
          </PressableCard>
        </>
      }
    >
      <View accessibilityRole="list">
        {EXERCISES.map((exercise, i) => {
          const title = t(`exercise.items.${exercise.id}.title`);
          const tagline = t(`exercise.items.${exercise.id}.tagline`);
          return (
            <Rise key={exercise.id} index={i + 2}>
              <View
                accessible
                accessibilityLabel={`${title}. ${tagline}`}
                style={[styles.row, { borderColor: colors.line }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[layout.cardTitle, styles.title]}>{title}</Text>
                  <Text style={layout.cardMeta}>{tagline}</Text>
                </View>
                <Text style={[styles.minutes, { color: colors.inkSoft }]}>
                  {t("exercise.minutes", { count: exerciseMinutes(exercise) }).toUpperCase()}
                </Text>
              </View>
            </Rise>
          );
        })}
      </View>
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 16,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  title: { fontFamily: fonts.displayRegular, fontSize: 20 },
  minutes: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.2, marginTop: 3 },
});
