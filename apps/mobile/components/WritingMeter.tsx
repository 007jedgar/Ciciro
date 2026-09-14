import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useAppTheme } from "../lib/settings";
import { useWritingDay } from "../lib/writing-day-session";
import { InfoBubble } from "./InfoBubble";

export function WritingMeter() {
  const { t } = useTranslation();
  const { settings, colors } = useAppTheme();
  const day = useWritingDay();

  if (!settings.showDailyGoal) return null;

  const goal = settings.dailyWordGoal;
  const ratio = goal > 0 ? Math.min(1, day.words / goal) : 0;
  const remaining = Math.max(0, goal - day.words);
  const met = goal > 0 && day.words >= goal;
  const title = t("settings.meterTitle");
  const count = t("settings.meterA11y", { words: day.words, goal });
  const status = met
    ? t("settings.meterDone")
    : t("settings.meterRemaining", { count: remaining });

  return (
    <View style={styles.wrap}>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={count}
        accessibilityValue={{ min: 0, max: goal, now: Math.min(day.words, goal) }}
        style={styles.bar}
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
      <InfoBubble
        title={title}
        body={`${count}\n${status}`}
        hint={t("settings.meterHint")}
        accessibilityLabel={t("info.aboutA11y", { topic: title })}
        testID="writing-meter-info"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  bar: {
    flex: 1,
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
