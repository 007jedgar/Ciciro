import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useAppTheme } from "../lib/settings";
import { useWritingDay } from "../lib/writing-day-session";

export function WritingMeter() {
  const { t } = useTranslation();
  const { settings, colors } = useAppTheme();
  const day = useWritingDay();

  if (!settings.showDailyGoal) return null;

  const ratio = settings.dailyWordGoal > 0 ? Math.min(1, day.words / settings.dailyWordGoal) : 0;

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t("settings.meterA11y", {
        words: day.words,
        goal: settings.dailyWordGoal,
      })}
      style={styles.wrap}
    >
      <View style={[styles.track, { backgroundColor: colors.line }]}>
        <View
          style={[
            styles.fill,
            { width: `${ratio * 100}%`, backgroundColor: colors.accent },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  track: {
    height: 4,
    borderRadius: 999,
    overflow: "hidden",
  },
  fill: {
    height: 4,
    borderRadius: 999,
  },
});
