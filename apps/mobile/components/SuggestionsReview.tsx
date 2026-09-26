import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { SuggestionAction, SuggestionPiece, SuggestionSummary } from "../lib/suggestions";
import { clipText, suggestionAge, suggestionAuthors } from "../lib/suggestion-review";
import { fonts, type ColorTokens } from "../lib/theme";
import { useAppTheme } from "../lib/settings";
import { alpha } from "./Glass";
import { GlassSheet } from "./GlassSheet";
import { EditorIcon } from "./icons";

// Tracked changes on the phone. The editor shows them inline (underline for
// added words, strikethrough for removed ones); this is where the author
// reads each one in context and accepts or rejects it.

function pieceStyle(kind: SuggestionPiece["kind"], colors: ColorTokens) {
  if (kind === "insert") {
    return {
      color: colors.draft,
      backgroundColor: alpha(colors.draft, 0.14),
      textDecorationLine: "underline" as const,
    };
  }
  if (kind === "delete") {
    return {
      color: colors.danger,
      backgroundColor: alpha(colors.danger, 0.12),
      textDecorationLine: "line-through" as const,
    };
  }
  return { color: colors.ink };
}

/** The row above the editor that says changes are waiting, styled like the open-questions banner. */
export function SuggestionsPill({
  suggestions,
  onOpen,
}: {
  suggestions: readonly SuggestionSummary[];
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  if (suggestions.length === 0) return null;
  const label = t("suggestions.pill", {
    count: suggestions.length,
    authors: suggestionAuthors(suggestions, t("suggestions.someone")),
  });
  return (
    <Pressable
      testID="suggestions-pill"
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${t("suggestions.review")}`}
      onPress={onOpen}
      style={({ pressed }) => [
        styles.pill,
        { borderColor: colors.line, backgroundColor: colors.accentSoft, opacity: pressed ? 0.75 : 1 },
      ]}
    >
      <EditorIcon color={colors.accent} size={18} />
      <Text style={[styles.pillLabel, { color: colors.ink }]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.pillAction, { color: colors.accent }]}>{t("suggestions.review")}</Text>
    </Pressable>
  );
}

function changeSentence(summary: SuggestionSummary, t: TFunction): string {
  const deleted = clipText(summary.deleted);
  const inserted = clipText(summary.inserted);
  if (deleted && inserted) return t("suggestions.replace", { deleted, inserted });
  if (inserted) return t("suggestions.add", { inserted });
  return t("suggestions.remove", { deleted });
}

export function SuggestionReviewCard({
  summary,
  colors,
  now,
  onResolve,
}: {
  summary: SuggestionSummary;
  colors: ColorTokens;
  now: number;
  onResolve: (action: SuggestionAction) => void;
}) {
  const { t } = useTranslation();
  const author = summary.authorName.trim() || t("suggestions.someone");
  const age = suggestionAge(summary.createdAt, now);
  const when = age ? t(`suggestions.${age.key}`, age.key === "justNow" ? {} : { count: age.count }) : "";
  return (
    <Animated.View
      testID={`suggestion-${summary.id}`}
      entering={FadeIn.duration(220)}
      exiting={FadeOut.duration(160)}
      layout={LinearTransition.duration(200)}
      style={[styles.card, { borderColor: colors.line, backgroundColor: colors.panel }]}
    >
      <View style={styles.cardHead}>
        <Text style={[styles.author, { color: colors.ink }]}>{author}</Text>
        {when ? <Text style={[styles.when, { color: colors.inkSoft }]}>{when}</Text> : null}
      </View>
      <Text
        style={styles.preview}
        accessibilityLabel={t("suggestions.a11yChange", { author, change: changeSentence(summary, t) })}
      >
        {summary.preview.map((piece, i) => (
          <Text key={i} style={pieceStyle(piece.kind, colors)}>
            {piece.text}
          </Text>
        ))}
      </Text>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t("suggestions.reject")}: ${changeSentence(summary, t)}`}
          onPress={() => onResolve("reject")}
          hitSlop={8}
          style={({ pressed }) => [styles.secondary, { borderColor: colors.line, opacity: pressed ? 0.7 : 1 }]}
        >
          <Text style={[styles.secondaryLabel, { color: colors.ink }]}>{t("suggestions.reject")}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t("suggestions.accept")}: ${changeSentence(summary, t)}`}
          onPress={() => onResolve("accept")}
          hitSlop={8}
          style={({ pressed }) => [styles.primary, { backgroundColor: colors.accent, opacity: pressed ? 0.82 : 1 }]}
        >
          <Text style={[styles.primaryLabel, { color: colors.panel }]}>{t("suggestions.accept")}</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

export function SuggestionsSheet({
  visible,
  suggestions,
  onClose,
  onResolve,
}: {
  visible: boolean;
  suggestions: readonly SuggestionSummary[];
  onClose: () => void;
  /** Accept or reject the given suggestions, or every one when ids is omitted. */
  onResolve: (action: SuggestionAction, ids?: string[]) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const [now, setNow] = useState(() => Date.now());
  const count = suggestions.length;

  useEffect(() => {
    if (!visible) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, [visible]);

  // Nothing left to review: step out of the way.
  useEffect(() => {
    if (visible && count === 0) onClose();
  }, [visible, count, onClose]);

  return (
    <GlassSheet
      visible={visible}
      onClose={onClose}
      title={t("suggestions.title")}
      snapPoints={[0.62, 0.92]}
      testID="suggestions-sheet"
    >
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={[styles.blurb, { color: colors.inkSoft }]}>{t("suggestions.blurb")}</Text>
        {count > 1 ? (
          <View style={styles.allRow}>
            <Pressable
              testID="suggestions-reject-all"
              accessibilityRole="button"
              onPress={() => onResolve("reject")}
              hitSlop={8}
              style={({ pressed }) => [styles.secondary, { borderColor: colors.line, opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={[styles.secondaryLabel, { color: colors.ink }]}>{t("suggestions.rejectAll")}</Text>
            </Pressable>
            <Pressable
              testID="suggestions-accept-all"
              accessibilityRole="button"
              onPress={() => onResolve("accept")}
              hitSlop={8}
              style={({ pressed }) => [styles.primary, { backgroundColor: colors.accent, opacity: pressed ? 0.82 : 1 }]}
            >
              <Text style={[styles.primaryLabel, { color: colors.panel }]}>{t("suggestions.acceptAll")}</Text>
            </Pressable>
          </View>
        ) : null}
        {suggestions.map((summary) => (
          <SuggestionReviewCard
            key={summary.id}
            summary={summary}
            colors={colors}
            now={now}
            onResolve={(action) => onResolve(action, [summary.id])}
          />
        ))}
      </ScrollView>
    </GlassSheet>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    alignSelf: "stretch",
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 10,
  },
  pillLabel: { flex: 1, fontSize: 14, lineHeight: 19 },
  pillAction: { fontSize: 13, fontWeight: "600" },
  scroll: { flex: 1 },
  content: { paddingBottom: 8 },
  blurb: { fontSize: 13, lineHeight: 19, marginBottom: 14 },
  allRow: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginBottom: 12 },
  card: {
    padding: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 12,
  },
  cardHead: { flexDirection: "row", alignItems: "baseline", gap: 8, marginBottom: 6 },
  author: { fontSize: 14, fontWeight: "600" },
  when: { fontSize: 12 },
  preview: { fontFamily: fonts.serif, fontSize: 16, lineHeight: 24 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 12 },
  primary: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999 },
  primaryLabel: { fontSize: 14, fontWeight: "600" },
  secondary: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  secondaryLabel: { fontSize: 14 },
});
