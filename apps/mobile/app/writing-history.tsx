import { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, withDelay, withTiming } from "react-native-reanimated";
import { Redirect, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { AppHeader, useMeasuredAppHeaderHeight } from "../components/AppHeader";
import { useWritingDaysQuery } from "../lib/api";
import { ciciro } from "../lib/api/resources";
import { useSession } from "../lib/session";
import { useAppTheme } from "../lib/settings";
import { fadeUpDelay } from "../lib/skeleton";
import { useReduceMotion } from "../lib/use-reduce-motion";
import { useStackBack } from "../lib/use-stack-back";
import { useWritingDay } from "../lib/writing-day-session";
import {
  bucketWritingDays,
  formatActiveDuration,
  overlayWritingDay,
  shiftWritingDayKey,
  summarizeWritingHistory,
  writingDayKey,
} from "../lib/writing-day";
import {
  averageSittingDurationMs,
  SITTING_AVG_MIN_COUNT,
  type WritingSessionTotals,
} from "../lib/writing-session";
import { FadeUp } from "../components/LoadingBlock";
import { RollingNumber } from "../components/RollingNumber";
import { Skeleton } from "../components/Skeleton";
import { TapPressable } from "../components/TapPressable";
import { WritingFrequencyLine } from "../components/WritingFrequencyLine";
import { countWritingFrequency } from "../lib/writing-frequency";
import { AlertText } from "../components/AlertText";

const HEATMAP_DAYS = 28;
const ALL_TIME_FROM = "2018-01-01";

/** A heatmap cell scales and fades in, each a little after the one before. */
const CELL_IN_MS = 320;
const CELL_STAGGER_MS = 16;
const CELL_STAGGER_MAX_MS = 440;

function cellEntering(index: number) {
  const delay = Math.min(index * CELL_STAGGER_MS, CELL_STAGGER_MAX_MS);
  const duration = CELL_IN_MS;
  return () => {
    "worklet";
    const timing = { duration, easing: Easing.out(Easing.cubic) };
    return {
      initialValues: { opacity: 0, transform: [{ scale: 0.55 }] },
      animations: {
        opacity: withDelay(delay, withTiming(1, timing)),
        transform: [{ scale: withDelay(delay, withTiming(1, timing)) }],
      },
    };
  };
}

function heatOpacity(words: number, maxWords: number): number {
  if (words <= 0 || maxWords <= 0) return 0;
  return 0.18 + 0.82 * Math.min(1, words / maxWords);
}

export default function WritingHistoryScreen() {
  const router = useRouter();
  const { backOr } = useStackBack();
  const { t } = useTranslation();
  const { user, ready } = useSession();
  const { layout, colors } = useAppTheme();
  const [headerHeight, onHeaderHeight] = useMeasuredAppHeaderHeight();
  const reduceMotion = useReduceMotion();
  const todaySnap = useWritingDay();
  const today = todaySnap.date || writingDayKey();
  const range = useWritingDaysQuery(ALL_TIME_FROM, today, { enabled: Boolean(user) });
  const [sessions, setSessions] = useState<WritingSessionTotals[] | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void ciciro.writing.sessions.list(50).then(
      (data) => {
        if (!cancelled) setSessions(data.sessions ?? []);
      },
      () => {
        if (!cancelled) setSessions([]);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [user]);

  const merged = useMemo(() => {
    const base = (range.data?.days ?? []).map((day) => ({
      date: day.date,
      words: day.words,
      activeMs: day.activeMs,
    }));
    return overlayWritingDay(base, {
      date: todaySnap.date,
      words: todaySnap.words,
      activeMs: todaySnap.activeMs,
    });
  }, [range.data?.days, todaySnap.date, todaySnap.words, todaySnap.activeMs]);

  const summary = useMemo(() => summarizeWritingHistory(merged, today), [merged, today]);
  const heatFrom = shiftWritingDayKey(today, -(HEATMAP_DAYS - 1));
  const buckets = useMemo(
    () => bucketWritingDays(merged, heatFrom, today),
    [merged, heatFrom, today]
  );
  const maxWords = useMemo(
    () => buckets.reduce((max, row) => Math.max(max, row.words), 0),
    [buckets]
  );
  const frequency = useMemo(() => countWritingFrequency(merged, today), [merged, today]);
  const avgSittingMs = useMemo(() => {
    if (!sessions || sessions.length < SITTING_AVG_MIN_COUNT) return null;
    return averageSittingDurationMs(sessions);
  }, [sessions]);

  if (!ready) return null;
  if (!user) return <Redirect href="/login" />;

  const loading = range.isPending && !range.data;
  const weekLabel = t("writingHistory.daysOfLast7", { count: summary.daysInLast7 });
  const error = range.isError ? t("writingHistory.loadError") : null;
  const timeAtKeys =
    avgSittingMs != null
      ? t("writingHistory.sittingAvgValue", { duration: formatActiveDuration(avgSittingMs) })
      : summary.avgActiveMs == null
        ? t("writingHistory.emptyValue")
        : t("writingHistory.timeAtKeysValue", {
            duration: formatActiveDuration(summary.avgActiveMs),
          });

  return (
    <View style={layout.screen}>
      <AppHeader
        title={t("writingHistory.title")}
        onBack={() => backOr("/manuscripts")}
        floating
        onHeightChange={onHeaderHeight}
      />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: headerHeight, paddingBottom: 32 }}
        scrollIndicatorInsets={{ top: headerHeight }}
      >
        {error ? (
          <AlertText style={layout.error} role="alert">
            {error}
          </AlertText>
        ) : null}

        {loading ? (
          <HistorySkeleton lineHeight={34} />
        ) : (
          <>
            <FadeUp index={0} style={{ marginBottom: 16 }}>
              <WritingFrequencyLine counts={frequency} />
            </FadeUp>

            <FadeUp index={1}>
              <Text style={[layout.cardMeta, { marginBottom: 8 }]}>{weekLabel}</Text>

              <View style={styles.heat} accessibilityLabel={t("writingHistory.heatmapA11y")}>
                {buckets.map((row, i) => (
                  <Animated.View
                    key={row.date}
                    entering={reduceMotion ? undefined : cellEntering(i)}
                    style={styles.heatCell}
                    accessibilityLabel={`${row.date}: ${t("writingHistory.wordsValue", { count: row.words })}`}
                  >
                    <View
                      style={[
                        styles.heatFill,
                        row.words > 0
                          ? { backgroundColor: colors.accent, opacity: heatOpacity(row.words, maxWords) }
                          : { backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line },
                      ]}
                    />
                  </Animated.View>
                ))}
              </View>
            </FadeUp>

            <StatRow
              index={2}
              label={t("writingHistory.week")}
              value={t("writingHistory.wordsValue", { count: summary.weekWords })}
              from={t("writingHistory.wordsValue", { count: 0 })}
              colors={colors}
            />
            <StatRow
              index={3}
              label={t("writingHistory.month")}
              value={t("writingHistory.wordsValue", { count: summary.monthWords })}
              from={t("writingHistory.wordsValue", { count: 0 })}
              colors={colors}
            />
            <StatRow
              index={4}
              label={t("writingHistory.allTime")}
              value={t("writingHistory.wordsValue", { count: summary.allTimeWords })}
              from={t("writingHistory.wordsValue", { count: 0 })}
              colors={colors}
            />
            <StatRow
              index={5}
              label={t("writingHistory.bestDay")}
              value={
                summary.bestDay
                  ? t("writingHistory.bestDayValue", {
                      count: summary.bestDay.words,
                      date: summary.bestDay.date,
                    })
                  : t("writingHistory.emptyValue")
              }
              colors={colors}
            />
            <StatRow index={6} label={t("writingHistory.timeAtKeys")} value={timeAtKeys} colors={colors} last />
          </>
        )}

        <TapPressable
          feedback="dim"
          onPress={() => router.push("/settings")}
          accessibilityRole="button"
          style={{ marginTop: 24 }}
        >
          <Text style={{ color: colors.accent, fontSize: 15 }}>{t("writingHistory.openSettings")}</Text>
        </TapPressable>
      </ScrollView>
    </View>
  );
}

function StatRow({
  label,
  value,
  from,
  index,
  colors,
  last,
}: {
  label: string;
  value: string;
  /** Where a rolling figure starts: it rolls up to `value` as the row arrives. Leave out for text that just appears. */
  from?: string;
  index: number;
  colors: { ink: string; inkSoft: string; line: string };
  last?: boolean;
}) {
  const reduceMotion = useReduceMotion();
  const rolls = from !== undefined && !reduceMotion;
  const [shown, setShown] = useState(rolls ? from : value);
  useEffect(() => {
    if (!rolls) {
      setShown(value);
      return;
    }
    // Wait for the row to fade up, then roll the figure up to its value (and on to later changes).
    const timer = setTimeout(() => setShown(value), fadeUpDelay(index) + FIGURE_ROLL_LEAD_MS);
    return () => clearTimeout(timer);
  }, [value, rolls, index]);
  return (
    <FadeUp
      index={index}
      style={[
        styles.statRow,
        { borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.line },
      ]}
    >
      <Text style={{ fontSize: 16, color: colors.inkSoft }}>{label}</Text>
      <View style={styles.statValue}>
        {rolls ? (
          <RollingNumber value={shown} style={{ fontSize: 16, lineHeight: 22, color: colors.ink }} />
        ) : (
          <Text style={{ fontSize: 16, color: colors.ink, textAlign: "right", flexShrink: 1 }}>{value}</Text>
        )}
      </View>
    </FadeUp>
  );
}

/** What stands in while the history loads: the shapes of the line, the heatmap and the stat rows. */
function HistorySkeleton({ lineHeight }: { lineHeight: number }) {
  const { t } = useTranslation();
  const label = t("common.loading");
  return (
    <View testID="writing-history-skeleton">
      <Skeleton width="68%" height={lineHeight - 6} radius={8} accessibilityLabel={label} style={{ marginBottom: 20 }} />
      <Skeleton width="36%" height={13} radius={6} accessibilityLabel={label} style={{ marginBottom: 12 }} />
      <Skeleton height={SKELETON_HEAT_HEIGHT} radius={8} accessibilityLabel={label} style={{ marginBottom: 24 }} />
      {[0, 1, 2, 3, 4].map((i) => (
        <Skeleton key={i} height={16} radius={6} accessibilityLabel={label} style={{ marginVertical: 14 }} />
      ))}
    </View>
  );
}

/** The rolling figure starts a beat after its row begins to fade up. */
const FIGURE_ROLL_LEAD_MS = 160;
const SKELETON_HEAT_HEIGHT = 150;

const styles = StyleSheet.create({
  heat: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginBottom: 20 },
  heatCell: { width: "12.5%", aspectRatio: 1, maxWidth: 36 },
  heatFill: { flex: 1, borderRadius: 3 },
  statRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, paddingVertical: 12 },
  statValue: { flexShrink: 1, alignItems: "flex-end" },
});
