import { ScrollView, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { Redirect } from "expo-router";
import { useTranslation } from "react-i18next";
import { AppHeader, useMeasuredAppHeaderHeight } from "../components/AppHeader";
import { ChoiceRow } from "../components/ChoiceRow";
import { SelectChip, SelectLabel } from "../components/SelectChip";
import { useSession } from "../lib/session";
import { useAppTheme } from "../lib/settings";
import { useReduceMotion } from "../lib/use-reduce-motion";
import { useStackBack } from "../lib/use-stack-back";
import { DAILY_WORD_GOAL_PRESETS } from "../lib/writing-day";

const WEEKLY_TARGETS = [3, 4, 5, 6, 7] as const;

/**
 * The daily word goal, on a screen of its own. A goal is optional: "No goal" is
 * the default, and with it the writing meter and the goal-met moment stay away
 * (`activeDailyGoal` in lib/app-settings.ts is what everything else reads).
 */
export default function WordGoalScreen() {
  const { backOr } = useStackBack();
  const { t } = useTranslation();
  const { user, ready } = useSession();
  const { settings, patch, layout, colors } = useAppTheme();
  const reduceMotion = useReduceMotion();
  const [headerHeight, onHeaderHeight] = useMeasuredAppHeaderHeight();

  if (!ready) return null;
  if (!user) return <Redirect href="/login" />;

  const hasGoal = settings.showDailyGoal;
  const goals: number[] = [...DAILY_WORD_GOAL_PRESETS];
  if (!goals.includes(settings.dailyWordGoal)) goals.push(settings.dailyWordGoal);
  goals.sort((a, b) => a - b);

  const chipTokens = {
    restFill: colors.panel,
    activeFill: colors.accent,
    restBorder: colors.line,
    activeBorder: colors.accent,
    restText: colors.ink,
    activeText: colors.panel,
  };

  return (
    <View style={layout.screen}>
      <AppHeader
        title={t("settings.wordGoal")}
        onBack={() => backOr("/settings")}
        floating
        onHeightChange={onHeaderHeight}
      />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: headerHeight + 8, paddingBottom: 40 }}
        scrollIndicatorInsets={{ top: headerHeight }}
      >
        <Text style={[layout.body, { marginBottom: 16 }]}>{t("wordGoal.blurb")}</Text>

        <ChoiceRow
          label={t("wordGoal.none")}
          selected={!hasGoal}
          colors={colors}
          onPress={() => patch({ showDailyGoal: false })}
        />
        {goals.map((goal) => (
          <ChoiceRow
            key={goal}
            label={t("wordGoal.perDay", { count: goal })}
            selected={hasGoal && settings.dailyWordGoal === goal}
            colors={colors}
            onPress={() => patch({ showDailyGoal: true, dailyWordGoal: goal })}
          />
        ))}

        {hasGoal ? (
          <Animated.View
            entering={reduceMotion ? undefined : FadeIn.duration(200)}
            exiting={reduceMotion ? undefined : FadeOut.duration(150)}
          >
            <Text style={[sectionLabel, { color: colors.inkSoft }]}>{t("settings.weeklyTarget")}</Text>
            <Text style={{ marginBottom: 10, fontSize: 14, lineHeight: 20, color: colors.inkSoft }}>
              {t("settings.dailyGoalHint", { count: settings.weeklyDayTarget })}
            </Text>
            <View style={{ flexDirection: "row", gap: 6 }}>
              {WEEKLY_TARGETS.map((days) => {
                const selected = settings.weeklyDayTarget === days;
                return (
                  <SelectChip
                    key={days}
                    selected={selected}
                    tokens={chipTokens}
                    accessibilityRole="button"
                    accessibilityLabel={t("settings.weeklyTargetValue", { count: days })}
                    accessibilityState={{ selected }}
                    onPress={() => patch({ weeklyDayTarget: days })}
                    style={{ flex: 1 }}
                    surfaceStyle={{
                      minHeight: 44,
                      borderRadius: 12,
                      alignItems: "center",
                      justifyContent: "center",
                      borderWidth: 1,
                    }}
                  >
                    <SelectLabel style={{ fontSize: 15 }}>{String(days)}</SelectLabel>
                  </SelectChip>
                );
              })}
            </View>
          </Animated.View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const sectionLabel = { marginTop: 18, marginBottom: 6, fontSize: 13, fontWeight: "600" as const };
