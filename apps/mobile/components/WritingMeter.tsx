import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useWritingDaysQuery } from "../lib/api";
import { hasCelebratedGoal, markGoalCelebrated } from "../lib/celebrations";
import { mixColors } from "../lib/color";
import * as haptics from "../lib/haptics";
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
import { DrawCheck, useDrawProgress } from "./DrawCheck";
import { InfoBubble } from "./InfoBubble";
import { TapPressable } from "./TapPressable";

/** The goal-met flash: up to a lighter accent, then back, with the tick drawing as it peaks. */
const FLASH_UP_MS = 160;
const FLASH_DOWN_MS = 640;
const FLASH_LIFT = 0.45;

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

  // Reaching the goal closes the loop: the fill flashes brighter, a tick draws itself in beside the week line and
  // the phone celebrates, once per day per account. A goal already celebrated today shows the finished tick.
  const met = goal > 0 && day.words >= goal;
  const userId = user?.id ?? "";
  const due = settings.showDailyGoal && met && Boolean(userId) && !hasCelebratedGoal(userId, today);
  const [tickPlays, setTickPlays] = useState(met && !due);
  const tickProgress = useDrawProgress(met && (tickPlays || !due), FLASH_UP_MS);
  const flash = useSharedValue(0);
  useEffect(() => {
    if (!due) return;
    markGoalCelebrated(userId, today);
    haptics.celebrate();
    setTickPlays(true);
    if (!reduceMotion) {
      flash.value = withSequence(
        withTiming(1, { duration: FLASH_UP_MS, easing: EASE_OUT }),
        withTiming(0, { duration: FLASH_DOWN_MS, easing: EASE_OUT })
      );
    }
  }, [due, userId, today, reduceMotion, flash]);
  const accent = colors.accent;
  const bright = mixColors(colors.accent, "#ffffff", FLASH_LIFT);
  const fillStyle = useAnimatedStyle(() => ({
    width: `${ratioV.value * 100}%`,
    backgroundColor: interpolateColor(flash.value, [0, 1], [accent, bright]),
  }));

  if (!settings.showDailyGoal) return null;

  const remaining = Math.max(0, goal - day.words);
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
        accessibilityLabel={`${count}. ${met ? `${t("settings.meterDone")}. ` : ""}${weekLabel}. ${t("writingHistory.openA11y")}`}
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
            <Animated.View style={[styles.fill, fillStyle]} />
          </View>
        </View>
        <View style={styles.weekRow}>
          <Text style={[styles.week, { color: colors.inkSoft }]} numberOfLines={1}>
            {weekLabel}
          </Text>
          <DrawCheck progress={tickProgress} color={colors.accent} size={16} />
        </View>
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
  weekRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  week: {
    fontSize: 12,
    flexShrink: 1,
  },
});
