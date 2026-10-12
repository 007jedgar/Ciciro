import { useEffect, useMemo, useRef } from "react";
import { AppState, Platform } from "react-native";
import { useWritingDaysQuery } from "../lib/api";
import { getLastPlace } from "../lib/last-place";
import { useSession } from "../lib/session";
import { activeDailyGoal } from "../lib/app-settings";
import { useAppTheme } from "../lib/settings";
import {
  countWritingDaysInWindow,
  overlayWritingDay,
  shiftWritingDayKey,
  writingDayKey,
} from "../lib/writing-day";
import { useWritingDay } from "../lib/writing-day-session";
import {
  buildWritingWidgetSnapshot,
  publishWritingWidgetSnapshot,
  SIGNED_OUT_WIDGET_SNAPSHOT,
} from "../lib/writing-widget";

/**
 * Keeps the iOS home/lock-screen writing widget aligned with today’s words and
 * the rolling 7-day count. No-op on Android/web and until a native rebuild.
 *
 * Publishes even signed out (a zero snapshot): the widget's native layout is
 * only registered with the OS as a side effect of the first published
 * snapshot, so gating this on `user` left the widget extension with no
 * layout to render - "No layout found" - until first sign-in.
 */
export function WritingWidgetSync() {
  const { user } = useSession();
  const { settings } = useAppTheme();
  const day = useWritingDay();
  const today = day.date || writingDayKey();
  const from = shiftWritingDayKey(today, -6);
  const range = useWritingDaysQuery(from, today, {
    enabled: Platform.OS === "ios" && Boolean(user),
  });
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

  const goal = activeDailyGoal(settings);
  const publishRef = useRef(() => {});
  publishRef.current = () => {
    if (Platform.OS !== "ios") return;
    const snapshot = user
      ? buildWritingWidgetSnapshot({
          words: day.words,
          goal,
          daysInLast7,
          lastPlace: getLastPlace(user.id),
        })
      : SIGNED_OUT_WIDGET_SNAPSHOT;
    void publishWritingWidgetSnapshot(snapshot);
  };

  useEffect(() => {
    publishRef.current();
  }, [user?.id, day.words, goal, daysInLast7, day.date]);

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") publishRef.current();
    });
    return () => sub.remove();
  }, []);

  return null;
}
