import { useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import { useTranslation } from "react-i18next";
import { alpha } from "../Glass";
import { TapPressable } from "../TapPressable";
import type { ScanReadingResponse } from "../../lib/api/types";
import { nextUncertainRange, uncertainCount, type ScanPageDraft } from "../../lib/notes-scan";
import { useAppTheme } from "../../lib/settings";
import { fonts } from "../../lib/theme";

const THUMB = 52;

/**
 * Step two: the recognized text, in a box the writer can fix. The photos stay
 * above it to check against, a page the reader could not make out is flagged,
 * and every word it was unsure of is marked `[?]` or `[illegible]` with a way
 * to jump from one to the next. Nothing goes anywhere from here.
 */
export function ReviewPage({
  pages,
  reading,
  text,
  autoCorrect,
  onChangeText,
  onNext,
  onScanAgain,
}: {
  pages: readonly ScanPageDraft[];
  reading: ScanReadingResponse;
  text: string;
  autoCorrect: boolean;
  onChangeText: (text: string) => void;
  onNext: () => void;
  onScanAgain: () => void;
}) {
  const { t } = useTranslation();
  const { colors, layout } = useAppTheme();
  const input = useRef<TextInput>(null);
  const cursor = useRef(0);
  const [selection, setSelection] = useState<{ start: number; end: number } | undefined>();

  const unsure = uncertainCount(text);
  const failed = reading.pages.filter((page) => page.failed).length;
  const blank = reading.pages.filter((page) => !page.failed && page.legibility === "unreadable").length;
  const empty = text.trim().length === 0;

  function jump() {
    const range = nextUncertainRange(text, cursor.current);
    if (!range) return;
    input.current?.focus();
    cursor.current = range.end;
    setSelection(range);
  }

  return (
    <View testID="scan-review">
      <Text style={[layout.cardTitle, styles.heading]}>{t("scanNotes.review.title")}</Text>
      <Text style={[layout.body, { marginBottom: 14 }]}>{t("scanNotes.review.blurb")}</Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.strip}
        accessibilityLabel={t("scanNotes.review.photos")}
        style={styles.stripScroll}
      >
        {pages.map((page, index) => {
          const state = reading.pages[index];
          const bad = state ? state.failed || state.legibility === "unreadable" : false;
          return (
            <View
              key={page.id}
              style={[
                styles.thumb,
                { borderColor: bad ? colors.danger : colors.line, borderWidth: bad ? 1.5 : StyleSheet.hairlineWidth },
              ]}
              accessible
              accessibilityLabel={t("scanNotes.capture.pageA11y", { number: index + 1 })}
            >
              <Image source={{ uri: page.uri }} contentFit="cover" style={StyleSheet.absoluteFill} />
              <View style={[styles.badge, { backgroundColor: alpha(colors.bg, 0.86) }]}>
                <Text style={[styles.badgeText, { color: colors.ink }]}>{index + 1}</Text>
              </View>
            </View>
          );
        })}
      </ScrollView>

      {failed > 0 ? (
        <Text testID="scan-failed-pages" style={[styles.note, { color: colors.danger }]}>
          {t("scanNotes.review.failedPages", { count: failed })}
        </Text>
      ) : null}
      {blank > 0 ? (
        <Text testID="scan-blank-pages" style={[styles.note, { color: colors.inkSoft }]}>
          {t("scanNotes.review.blankPages", { count: blank })}
        </Text>
      ) : null}

      {unsure > 0 ? (
        <View style={[styles.unsure, { backgroundColor: colors.panel, borderColor: colors.line }]} testID="scan-unsure">
          <View style={styles.unsureRow}>
            <Text style={[styles.unsureCount, { color: colors.ink }]}>{t("scanNotes.review.unsure", { count: unsure })}</Text>
            <TapPressable
              testID="scan-next-unsure"
              feedback="dim"
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t("scanNotes.review.unsureA11y")}
              onPress={jump}
            >
              <Text style={[styles.unsureNext, { color: colors.accent }]}>{t("scanNotes.review.nextUnsure")}</Text>
            </TapPressable>
          </View>
          <Text style={[styles.unsureHint, { color: colors.inkSoft }]}>{t("scanNotes.review.unsureHint")}</Text>
        </View>
      ) : null}

      <TextInput
        ref={input}
        testID="scan-text"
        style={[layout.input, styles.input]}
        value={text}
        onChangeText={onChangeText}
        selection={selection}
        onSelectionChange={(event) => {
          const next = event.nativeEvent.selection;
          cursor.current = next.end;
          if (selection && next.start === selection.start && next.end === selection.end) setSelection(undefined);
        }}
        multiline
        scrollEnabled={false}
        textAlignVertical="top"
        autoCorrect={autoCorrect}
        autoCapitalize="sentences"
        placeholderTextColor={colors.inkSoft}
        accessibilityLabel={t("scanNotes.review.inputLabel")}
      />

      <TapPressable
        testID="scan-next"
        style={[layout.primaryBtn, { marginTop: 8, opacity: empty ? 0.5 : 1 }]}
        disabled={empty}
        onPress={onNext}
        accessibilityRole="button"
        accessibilityState={{ disabled: empty }}
      >
        <Text style={layout.primaryBtnText}>{t("scanNotes.review.next")}</Text>
      </TapPressable>
      <TapPressable
        testID="scan-again"
        style={layout.ghostBtn}
        onPress={onScanAgain}
        accessibilityRole="button"
        feedback="dim"
      >
        <Text style={layout.ghostBtnText}>{t("scanNotes.review.scanAgain")}</Text>
      </TapPressable>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 22, marginBottom: 6 },
  stripScroll: { flexGrow: 0, marginBottom: 12 },
  strip: { gap: 8 },
  thumb: { width: THUMB, height: Math.round((THUMB * 4) / 3), borderRadius: 6, overflow: "hidden" },
  badge: {
    position: "absolute",
    left: 4,
    bottom: 4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontFamily: fonts.monoMedium, fontSize: 10 },
  note: { fontFamily: fonts.ui, fontSize: 13.5, lineHeight: 19, marginBottom: 8 },
  unsure: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12 },
  unsureRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  unsureCount: { fontFamily: fonts.uiBold, fontSize: 14.5 },
  unsureNext: { fontFamily: fonts.uiMedium, fontSize: 14.5 },
  unsureHint: { fontFamily: fonts.ui, fontSize: 13, lineHeight: 18, marginTop: 4 },
  input: { minHeight: 280, lineHeight: 24, paddingTop: 12, marginBottom: 12 },
});
