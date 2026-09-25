import { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { AppHeader, useAppHeaderHeight } from "../components/AppHeader";
import { useWritingDaysQuery } from "../lib/api";
import { useSession } from "../lib/session";
import { useAppTheme } from "../lib/settings";
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

const HEATMAP_DAYS = 28;
const ALL_TIME_FROM = "2018-01-01";

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
  const headerHeight = useAppHeaderHeight();
  const todaySnap = useWritingDay();
  const today = todaySnap.date || writingDayKey();
  const range = useWritingDaysQuery(ALL_TIME_FROM, today, { enabled: Boolean(user) });

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

  if (!ready) return null;
  if (!user) return <Redirect href="/login" />;

  const weekLabel = t("history.daysOfLast7", { count: summary.daysInLast7 });
  const error = range.isError ? t("history.loadError") : null;

  return (
    <View style={layout.screen}>
      <AppHeader
        title={t("history.title")}
        onBack={() => backOr("/manuscripts")}
        floating
      />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: headerHeight, paddingBottom: 32 }}
        scrollIndicatorInsets={{ top: headerHeight }}
      >
        {error ? (
          <Text style={layout.error} role="alert">
            {error}
          </Text>
        ) : null}

        <Text style={[layout.cardMeta, { marginBottom: 8 }]}>{weekLabel}</Text>

        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: 4,
            marginBottom: 20,
          }}
          accessibilityLabel={t("history.heatmapA11y")}
        >
          {buckets.map((row) => (
            <View
              key={row.date}
              style={{
                width: "12.5%",
                aspectRatio: 1,
                maxWidth: 36,
                borderRadius: 3,
                backgroundColor: row.words > 0 ? colors.accent : colors.line,
                opacity: row.words > 0 ? heatOpacity(row.words, maxWords) : 0.35,
              }}
              accessibilityLabel={`${row.date}: ${row.words}`}
            />
          ))}
        </View>

        <StatRow
          label={t("history.week")}
          value={t("history.wordsValue", { count: summary.weekWords })}
          colors={colors}
        />
        <StatRow
          label={t("history.month")}
          value={t("history.wordsValue", { count: summary.monthWords })}
          colors={colors}
        />
        <StatRow
          label={t("history.allTime")}
          value={t("history.wordsValue", { count: summary.allTimeWords })}
          colors={colors}
        />
        <StatRow
          label={t("history.bestDay")}
          value={
            summary.bestDay
              ? t("history.bestDayValue", {
                  count: summary.bestDay.words,
                  date: summary.bestDay.date,
                })
              : t("history.emptyValue")
          }
          colors={colors}
        />
        <StatRow
          label={t("history.timeAtKeys")}
          value={
            summary.avgActiveMs == null
              ? t("history.emptyValue")
              : t("history.timeAtKeysValue", {
                  duration: formatActiveDuration(summary.avgActiveMs),
                })
          }
          colors={colors}
          last
        />

        {range.isPending && !range.data ? (
          <Text style={[layout.body, { marginTop: 16 }]}>{t("common.loading")}</Text>
        ) : null}

        <Pressable
          onPress={() => router.push("/settings")}
          accessibilityRole="button"
          style={{ marginTop: 24 }}
        >
          <Text style={{ color: colors.accent, fontSize: 15 }}>{t("history.openSettings")}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function StatRow({
  label,
  value,
  colors,
  last,
}: {
  label: string;
  value: string;
  colors: { ink: string; inkSoft: string; line: string };
  last?: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        gap: 12,
        paddingVertical: 12,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.line,
      }}
    >
      <Text style={{ fontSize: 16, color: colors.inkSoft }}>{label}</Text>
      <Text style={{ fontSize: 16, color: colors.ink, textAlign: "right", flexShrink: 1 }}>
        {value}
      </Text>
    </View>
  );
}
