import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import Animated, { FadeIn } from "react-native-reanimated";
import { MANUSCRIPT_KINDS, type ManuscriptKind } from "../lib/manuscript-kind";
import { PressableCard } from "../components/PressableCard";
import { OnboardingHeader } from "../components/onboarding/OnboardingHeader";
import { useAppTheme } from "../lib/settings";
import { useStackBack } from "../lib/use-stack-back";
import { useReduceMotion } from "../lib/use-reduce-motion";
import { getAnalytics } from "../lib/analytics-client";

/** Q1 of the pre-signup onboarding quiz: "What are you working on?" */
export default function OnboardingGoalScreen() {
  const router = useRouter();
  const { backOr } = useStackBack();
  const { t } = useTranslation();
  const { layout } = useAppTheme();
  const reduceMotion = useReduceMotion();

  function choose(kind: ManuscriptKind) {
    getAnalytics().track("onboarding_goal_selected", { kind });
    router.push({ pathname: "/onboarding-obstacle", params: { kind } });
  }

  function skip() {
    getAnalytics().track("onboarding_skipped", { step: "goal" });
    router.push("/signup");
  }

  return (
    <View style={layout.screen}>
      <OnboardingHeader onBack={() => backOr("/")} onSkip={skip} />
      <Animated.View
        entering={reduceMotion ? undefined : FadeIn.duration(220)}
        style={{ paddingHorizontal: 20, paddingTop: 20 }}
      >
        <Text style={[layout.title, { marginBottom: 20 }]}>{t("onboarding.goalQuestion")}</Text>
        <View accessibilityRole="radiogroup" style={{ gap: 10 }}>
          {MANUSCRIPT_KINDS.map((option) => (
            <PressableCard
              key={option}
              onPress={() => choose(option)}
              accessibilityRole="radio"
              accessibilityLabel={t(`kinds.${option}.label`)}
              style={layout.card}
            >
              <Text style={layout.cardTitle}>{t(`kinds.${option}.label`)}</Text>
              <Text style={layout.cardMeta}>{t(`kinds.${option}.description`)}</Text>
            </PressableCard>
          ))}
        </View>
      </Animated.View>
    </View>
  );
}
