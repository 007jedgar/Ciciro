import { useState } from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { OBSTACLES, toggleObstacle, type Obstacle } from "../lib/onboarding";
import { PressableCard } from "../components/PressableCard";
import { ChoiceCard } from "../components/onboarding/ChoiceCard";
import { OnboardingFrame, Rise } from "../components/onboarding/OnboardingFrame";
import { useAppTheme } from "../lib/settings";
import { useStackBack } from "../lib/use-stack-back";
import { getAnalytics } from "../lib/analytics-client";
import { onboardingParams, parseOnboardingParams, stepsFor } from "../lib/onboarding-flow";

/** Q2 of the pre-signup onboarding quiz: "What's getting in the way?" Pick as many as apply. */
export default function OnboardingObstacleScreen() {
  const router = useRouter();
  const { backOr } = useStackBack();
  const { t } = useTranslation();
  const { layout } = useAppTheme();
  const params = useLocalSearchParams<{ kind?: string }>();
  const { kind } = parseOnboardingParams(params);
  const [selected, setSelected] = useState<Obstacle[]>([]);
  const ready = selected.length > 0;

  function toggle(obstacle: Obstacle) {
    setSelected((current) => toggleObstacle(current, obstacle));
  }

  function next() {
    if (!ready) return;
    getAnalytics().track("onboarding_obstacle_selected", { obstacles: selected.join(","), count: selected.length });
    router.push({ pathname: "/onboarding-look", params: onboardingParams({ kind, obstacles: selected }) });
  }

  function skip() {
    getAnalytics().track("onboarding_skipped", { step: "obstacle" });
    router.push({ pathname: "/signup", params: onboardingParams({ kind }) });
  }

  return (
    <OnboardingFrame
      // The reminder knot grows onto the thread the moment "consistency" is ticked.
      steps={stepsFor(selected)}
      step="obstacle"
      title={t("onboarding.obstacleQuestion")}
      body={t("onboarding.obstacleHint")}
      onBack={() => backOr("/")}
      onSkip={skip}
      footer={
        <PressableCard
          accent
          onPress={next}
          disabled={!ready}
          accessibilityRole="button"
          accessibilityLabel={t("onboarding.continue")}
          accessibilityState={{ disabled: !ready }}
          style={[layout.primaryBtn, { marginTop: 0, opacity: ready ? 1 : 0.45 }]}
        >
          <Text style={layout.primaryBtnText}>{t("onboarding.continue")}</Text>
        </PressableCard>
      }
    >
      <View accessibilityRole="list" style={{ gap: 10 }}>
        {OBSTACLES.map((option, i) => (
          <Rise key={option} index={i + 2}>
            <ChoiceCard
              title={t(`onboarding.obstacles.${option}.label`)}
              description={t(`onboarding.obstacles.${option}.description`)}
              selected={selected.includes(option)}
              onPress={() => toggle(option)}
            />
          </Rise>
        ))}
      </View>
    </OnboardingFrame>
  );
}
