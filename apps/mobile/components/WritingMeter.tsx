import { useEffect, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useWritingDaysQuery } from "../lib/api";
import { EASE_OUT } from "../lib/motion";
import { useAppTheme } from "../lib/settings";
import { useSession } from "../lib/session";
import { useReduceMotion } from "../lib/use-reduce-motion";
import { useWritingDay } from "../lib/writing-day-session";
import {
  countWritingDaysInWindow,
  overlayWritingDay,
  shiftWritingDayKey,
  writingDayKey,
} from "../lib/writing-day";
import { InfoBubble } from "./InfoBubble";
import { TapPressable } from "./TapPressable";

export function WritingMeter() {
  const { t } = useTranslation();
  const router = useRouter();
  const { user } = useSession();
  const { settings, colors } = useAppTheme();
  const day = useWritingDay();
  const today = day.date || writingDayKey();
  const from = shiftWritingDayKey(today, -6);
  const range = useWritingDaysQuery(from, today, { enabled: Boolean(user) && settings.showDailyGoal });

  const daysInLast7 = useMemo(() => {
    const base = (range.data?.days ?? []).map((row) => ({
      date: row.date,
      words: row.words,
      activeMs: row.activeMs,
    }));
    const merged = overlayWritingDay(base, {
      date: day.date,
      words: day.words,
      activeMs: day.activeMs,
    });
    return countWritingDaysInWindow(merged, today);
  }, [range.data?.days, day.date, day.words, day.activeMs, today]);

  const goal = settings.dailyWordGoal;
  const ratio = goal > 0 ? Math.min(1, day.words / goal) : 0;
  const reduceMotion = useReduceMotion();
  const ratioV = useSharedValue(ratio);
  useEffect(() => {
    ratioV.value = reduceMotion ? ratio : withTiming(ratio, { duration: 280, easing: EASE_OUT });
  }, [ratio, reduceMotion, ratioV]);
  const fillStyle = useAnimatedStyle(() => ({ width: `${ratioV.value * 100}%` }));

  if (!settings.showDailyGoal) return null;

  const remaining = Math.max(0, goal - day.words);
  const met = goal > 0 && day.words >= goal;
  const title = t("settings.meterTitle");
  const count = t("settings.meterA11y", { words: day.words, goal });
  const status = met
    ? t("settings.meterDone")
    : t("settings.meterRemaining", { count: remaining });
  const weekLabel = t("writingHistory.daysOfLast7", { count: daysInLast7 });

  return (
    <View style={styles.wrap}>
      <TapPressable
        feedback="dim"
        onPress={() => router.push("/writing-history")}
        accessibilityRole="button"
        accessibilityLabel={`${count}. ${weekLabel}. ${t("writingHistory.openA11y")}`}
        style={styles.barPress}
      >
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={count}
          accessibilityValue={{ min: 0, max: goal, now: Math.min(day.words, goal) }}
          style={styles.bar}
        >
          <View style={[styles.track, { backgroundColor: colors.line }]}>
            <Animated.View style={[styles.fill, fillStyle, { backgroundColor: colors.accent }]} />
          </View>
        </View>
        <Text style={[styles.week, { color: colors.inkSoft }]} numberOfLines={1}>
          {weekLabel}
        </Text>
      </TapPressable>
      <InfoBubble
        title={title}
        body={`${count}\n${status}\n${weekLabel}`}
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
  barPress: {
    flex: 1,
    gap: 6,
  },
  bar: {
    flexGrow: 0,
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
  week: {
    fontSize: 12,
  },
});
