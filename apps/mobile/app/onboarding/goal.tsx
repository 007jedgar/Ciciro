import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { MANUSCRIPT_KINDS, type ManuscriptKind } from "../../lib/manuscript-kind";
import { BetaBadge } from "../../components/BetaBadge";
import { ScriptLanguageInfo } from "../../components/ScriptLanguageInfo";
import { useScriptLanguageSupported } from "../../lib/script-language";
import { PressableCard } from "../../components/PressableCard";
import { OnboardingFrame, Rise } from "../../components/onboarding/OnboardingFrame";
import { useCarryLooks } from "../../components/onboarding/carry-looks";
import { useAppTheme } from "../../lib/settings";
import { useStackBack } from "../../lib/use-stack-back";
import { getAnalytics } from "../../lib/analytics-client";
import { onboardingParams, stepsFor } from "../../lib/onboarding-flow";
import { useCarry, useCarryNodes } from "../../lib/onboarding-shell";

/** Q1 of the pre-signup onboarding quiz: "What are you working on?" */
export default function OnboardingGoalScreen() {
  const router = useRouter();
  const { backOr } = useStackBack();
  const { t } = useTranslation();
  const scriptLanguage = useScriptLanguageSupported();
  const { layout } = useAppTheme();
  const carry = useCarry();
  const nodes = useCarryNodes();
  const looks = useCarryLooks();

  async function choose(kind: ManuscriptKind) {
    const label = t(`kinds.${kind}.label`);
    const source = nodes.get(kind);
    // The card flies into the first chip, and the next question arrives as it goes.
    const flying = await carry.fly([
      {
        chip: { id: "kind", step: "goal", label },
        card: source.card,
        title: source.title,
        look: looks.card(label, t(`kinds.${kind}.description`)),
      },
    ]);
    if (!flying) return;
    getAnalytics().track("onboarding_goal_selected", { kind });
    router.push({ pathname: "/onboarding/obstacle", params: onboardingParams({ kind }) });
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
      leave={carry.fadeStyle}
    >
      <View accessibilityRole="radiogroup" style={{ gap: 10 }}>
        {MANUSCRIPT_KINDS.map((option, i) => {
          // A script is set in Courier for English and Spanish; other languages are planned.
          const unavailable = option === "screenplay" && !scriptLanguage;
          return (
            <Rise key={option} index={i + 1}>
              <PressableCard
                ref={nodes.cardRef(option)}
                onPress={() => void choose(option)}
                disabled={unavailable}
                accessibilityRole="radio"
                accessibilityState={{ disabled: unavailable }}
                accessibilityLabel={t(`kinds.${option}.label`)}
                accessibilityHint={option === "screenplay" ? `${t("screenplay.beta")}. ${t("screenplay.betaInfo")}` : undefined}
                style={[layout.card, unavailable ? { opacity: 0.5 } : null]}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text ref={nodes.titleRef(option)} style={layout.cardTitle}>
                    {t(`kinds.${option}.label`)}
                  </Text>
                  {option === "screenplay" ? <BetaBadge testID="goal-beta-badge" /> : null}
                  {unavailable ? <ScriptLanguageInfo testID="goal-language-info" /> : null}
                </View>
                <Text style={layout.cardMeta}>{t(`kinds.${option}.description`)}</Text>
              </PressableCard>
            </Rise>
          );
        })}
      </View>
    </OnboardingFrame>
  );
}
