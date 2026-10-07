import { Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import Animated, { FadeIn } from "react-native-reanimated";
import { normalizeKind } from "../lib/manuscript-kind";
import { OBSTACLES, type Obstacle } from "../lib/onboarding";
import { PressableCard } from "../components/PressableCard";
import { OnboardingHeader } from "../components/onboarding/OnboardingHeader";
import { useAppTheme } from "../lib/settings";
import { useStackBack } from "../lib/use-stack-back";
import { useReduceMotion } from "../lib/use-reduce-motion";
import { getAnalytics } from "../lib/analytics-client";

/** Q2 of the pre-signup onboarding quiz: "What's getting in the way?" */
export default function OnboardingObstacleScreen() {
  const router = useRouter();
  const { backOr } = useStackBack();
  const { t } = useTranslation();
  const { layout } = useAppTheme();
  const reduceMotion = useReduceMotion();
  const params = useLocalSearchParams<{ kind?: string }>();
  const kind = normalizeKind(params.kind);

  function choose(obstacle: Obstacle) {
    getAnalytics().track("onboarding_obstacle_selected", { obstacle });
    router.push({ pathname: "/onboarding-demo", params: { kind, obstacle } });
  }

  function skip() {
    getAnalytics().track("onboarding_skipped", { step: "obstacle" });
    router.push({ pathname: "/signup", params: { kind } });
  }

  return (
    <View style={layout.screen}>
      <OnboardingHeader onBack={() => backOr("/")} onSkip={skip} />
      <Animated.View
        entering={reduceMotion ? undefined : FadeIn.duration(220)}
        style={{ paddingHorizontal: 20, paddingTop: 20 }}
      >
        <Text style={[layout.title, { marginBottom: 20 }]}>{t("onboarding.obstacleQuestion")}</Text>
        <View accessibilityRole="radiogroup" style={{ gap: 10 }}>
          {OBSTACLES.map((option) => (
            <PressableCard
              key={option}
              onPress={() => choose(option)}
              accessibilityRole="radio"
              accessibilityLabel={t(`onboarding.obstacles.${option}.label`)}
              style={layout.card}
            >
              <Text style={layout.cardTitle}>{t(`onboarding.obstacles.${option}.label`)}</Text>
              <Text style={layout.cardMeta}>{t(`onboarding.obstacles.${option}.description`)}</Text>
            </PressableCard>
          ))}
        </View>
      </Animated.View>
    </View>
  );
}
