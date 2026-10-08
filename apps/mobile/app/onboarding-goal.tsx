import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { MANUSCRIPT_KINDS, type ManuscriptKind } from "../lib/manuscript-kind";
import { PressableCard } from "../components/PressableCard";
import { OnboardingFrame, Rise } from "../components/onboarding/OnboardingFrame";
import { useAppTheme } from "../lib/settings";
import { useStackBack } from "../lib/use-stack-back";
import { getAnalytics } from "../lib/analytics-client";
import { onboardingParams, stepsFor } from "../lib/onboarding-flow";

/** Q1 of the pre-signup onboarding quiz: "What are you working on?" */
export default function OnboardingGoalScreen() {
  const router = useRouter();
  const { backOr } = useStackBack();
  const { t } = useTranslation();
  const { layout } = useAppTheme();

  function choose(kind: ManuscriptKind) {
    getAnalytics().track("onboarding_goal_selected", { kind });
    router.push({ pathname: "/onboarding-obstacle", params: onboardingParams({ kind }) });
  }

  function skip() {
    getAnalytics().track("onboarding_skipped", { step: "goal" });
    router.push("/signup");
  }

  return (
    <OnboardingFrame
      steps={stepsFor([])}
      step="goal"
      title={t("onboarding.goalQuestion")}
      onBack={() => backOr("/")}
      onSkip={skip}
    >
      <View accessibilityRole="radiogroup" style={{ gap: 10 }}>
        {MANUSCRIPT_KINDS.map((option, i) => (
          <Rise key={option} index={i + 1}>
            <PressableCard
              onPress={() => choose(option)}
              accessibilityRole="radio"
              accessibilityLabel={t(`kinds.${option}.label`)}
              style={layout.card}
            >
              <Text style={layout.cardTitle}>{t(`kinds.${option}.label`)}</Text>
              <Text style={layout.cardMeta}>{t(`kinds.${option}.description`)}</Text>
            </PressableCard>
          </Rise>
        ))}
      </View>
    </OnboardingFrame>
  );
}
