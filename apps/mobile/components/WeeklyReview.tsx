import { useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { ApiError } from "../lib/api/client";
import {
  useCreateWeeklyReviewMutation,
  useDeleteWeeklyReviewMutation,
  useWeeklyReviewsQuery,
} from "../lib/api";
import type { WeeklyReview as Review } from "../lib/api/types";
import { useOptionalAppTheme } from "../lib/settings";
import { colors as parchmentColors, layout as parchmentLayout } from "../lib/theme";
import { barShare, formatWeekRange } from "../lib/weekly-review";
import { writingDayKey, formatActiveDuration } from "../lib/writing-day";
import { SkeletonList } from "./Skeleton";

function ReviewBody({ review }: { review: Review }) {
  const { t } = useTranslation();
  const themed = useOptionalAppTheme();
  const layout = themed?.layout ?? parchmentLayout;
  const colors = themed?.colors ?? parchmentColors;
  const { stats, content } = review;
  const max = Math.max(0, ...stats.days.map((d) => d.words));
  const active = stats.activeMs > 0 ? formatActiveDuration(stats.activeMs) : "";
  return (
    <View testID="weekly-review-body">
      <Text style={[layout.cardMeta, { marginBottom: 4 }]}>{t("weekly.accountWide")}</Text>
      <Text style={[layout.cardMeta, { marginBottom: 8 }]}>
        {t("weekly.statsLine", { words: stats.words, count: stats.daysWritten })}
        {active ? ` · ${active}` : ""}
      </Text>
      <View
        style={{ flexDirection: "row", alignItems: "flex-end", height: 48, gap: 4, marginBottom: 14 }}
        accessibilityLabel={t("weekly.chartLabel")}
      >
        {stats.days.map((d) => (
          <View
            key={d.date}
            style={{
              flex: 1,
              height: `${Math.round(barShare(d.words, max) * 100)}%`,
              borderRadius: 3,
              opacity: d.words > 0 ? 1 : 0.3,
              backgroundColor: colors.accent,
            }}
          />
        ))}
      </View>
      <Text style={[layout.body, { marginBottom: 16 }]}>{content.summary}</Text>
      <Text style={layout.cardTitle}>{t("weekly.touched")}</Text>
      {stats.chaptersTouched.length === 0 ? (
        <Text style={[layout.cardMeta, { marginBottom: 14 }]}>{t("weekly.touchedNone")}</Text>
      ) : (
        stats.chaptersTouched.map((c) => (
          <Text key={c.id} style={layout.body}>
            {`• ${c.title} (${t("weekly.words", { count: c.wordCount })})`}
          </Text>
        ))
      )}
      <Text style={[layout.cardTitle, { marginTop: 14 }]}>{t("weekly.looseEnds")}</Text>
      {content.looseEnds.length === 0 ? (
        <Text style={[layout.cardMeta, { marginBottom: 14 }]}>{t("weekly.looseEndsNone")}</Text>
      ) : (
        content.looseEnds.map((item, i) => (
          <Text key={i} style={layout.body}>{`• ${item}`}</Text>
        ))
      )}
      <Text style={[layout.cardTitle, { marginTop: 14 }]}>{t("weekly.next")}</Text>
      {content.nextSteps.map((item, i) => (
        <Text key={i} style={layout.body}>{`• ${item}`}</Text>
      ))}
    </View>
  );
}

/** The weekly review: the newest review, a button to write another, and past ones to reread. */
export function WeeklyReview({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const themed = useOptionalAppTheme();
  const layout = themed?.layout ?? parchmentLayout;
  const reviews = useWeeklyReviewsQuery(projectId);
  const create = useCreateWeeklyReviewMutation();
  const remove = useDeleteWeeklyReviewMutation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (create.isPending) return;
    setError(null);
    try {
      const review = await create.mutateAsync({ projectId, to: writingDayKey() });
      setSelectedId(review.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("weekly.createError"));
    }
  }

  function confirmDelete(review: Review) {
    Alert.alert(t("weekly.deleteTitle"), t("weekly.deleteMessage"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: () => {
          setError(null);
          setSelectedId(null);
          remove.mutateAsync({ projectId, reviewId: review.id }).catch((err: unknown) => {
            setError(err instanceof ApiError ? err.message : t("weekly.deleteError"));
          });
        },
      },
    ]);
  }

  if (reviews.isPending && !reviews.data) {
    return (
      <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
        <SkeletonList count={3} accessibilityLabel={t("common.loading")} />
      </View>
    );
  }

  const list = reviews.data?.reviews ?? [];
  const due = reviews.data?.due ?? false;
  const selected = list.find((r) => r.id === selectedId) ?? list[0] ?? null;
  return (
    <ScrollView
      testID="weekly-review"
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}
    >
      <Text style={[layout.body, { marginBottom: 16 }]}>{t("weekly.blurb")}</Text>
      {error ? (
        <Text style={[layout.error, { marginTop: 0, marginBottom: 12 }]} role="alert">
          {error}
        </Text>
      ) : null}
      {reviews.isError ? (
        <Text style={[layout.error, { marginTop: 0, marginBottom: 12 }]} role="alert">
          {t("weekly.loadError")}
        </Text>
      ) : null}
      <Pressable
        style={[layout.card, { marginBottom: 16, opacity: create.isPending ? 0.6 : 1 }]}
        onPress={() => void generate()}
        disabled={create.isPending}
        accessibilityRole="button"
        accessibilityLabel={due ? t("weekly.reviewNow") : t("weekly.writeNew")}
      >
        <Text style={layout.cardTitle}>
          {create.isPending ? t("weekly.working") : due ? t("weekly.reviewNow") : t("weekly.writeNew")}
        </Text>
      </Pressable>
      {list.length === 0 && !reviews.isError ? (
        <Text style={layout.body}>{t("weekly.empty")}</Text>
      ) : null}
      {selected ? (
        <View style={{ marginBottom: 20 }}>
          <Pressable
            onLongPress={() => confirmDelete(selected)}
            accessibilityHint={t("weekly.deleteHint")}
            accessibilityActions={[{ name: "delete", label: t("common.delete") }]}
            onAccessibilityAction={() => confirmDelete(selected)}
          >
            <Text style={[layout.cardTitle, { marginBottom: 8 }]}>
              {formatWeekRange(selected.weekStart, selected.weekEnd)}
            </Text>
          </Pressable>
          <ReviewBody review={selected} />
        </View>
      ) : null}
      {list.length > 1 ? (
        <>
          <Text style={[layout.cardMeta, { marginBottom: 8 }]}>{t("weekly.past")}</Text>
          {list.map((r) => (
            <Pressable
              key={r.id}
              style={[layout.card, { marginBottom: 12 }]}
              onPress={() => setSelectedId(r.id)}
              accessibilityRole="button"
              accessibilityLabel={t("weekly.open", {
                range: formatWeekRange(r.weekStart, r.weekEnd),
              })}
            >
              <Text style={layout.cardTitle}>{formatWeekRange(r.weekStart, r.weekEnd)}</Text>
              <Text style={layout.cardMeta}>{t("weekly.words", { count: r.stats.words })}</Text>
            </Pressable>
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}
