import { StyleSheet, Text, View } from "react-native";
import { TapPressable } from "./TapPressable";
import { useTranslation } from "react-i18next";
import { ChapterStatusPicker } from "./ChapterStatusPicker";
import { alpha } from "./Glass";
import { chapterHeading, CHAPTER_PREVIEW_LINES } from "../lib/chapter-label";
import type { ManuscriptKind } from "../lib/manuscript-kind";
import { htmlToPlainText } from "../lib/html";
import { htmlWithoutSuggestions } from "../lib/suggestions";
import type { ChapterStatus } from "../lib/chapter-status";
import { useOptionalAppTheme } from "../lib/settings";
import { colors as parchmentColors, fonts, layout as parchmentLayout } from "../lib/theme";
import type { Chapter } from "../lib/types";
import { TrashIcon, VersionHistoryIcon } from "./icons";

/**
 * A chapter as a file in the archive: a mono folder tab, a sheet with the
 * landing's red margin rule, the title in light display type, the stage as
 * paper stock.
 */
export function ChapterListCard({
  chapter,
  number,
  selected,
  deleting = false,
  onOpen,
  onRequestDelete,
  onStatusChange,
  onOpenHistory,
  kind = "novel",
}: {
  chapter: Chapter;
  /** 1-based index in the live chapter list. */
  number: number;
  selected: boolean;
  deleting?: boolean;
  onOpen: () => void;
  onRequestDelete: () => void;
  onStatusChange?: (status: ChapterStatus) => void;
  /** Browse and restore this chapter's snapshots. */
  onOpenHistory?: () => void;
  /** What is being written; sets how the row is named. Defaults to a novel. */
  kind?: ManuscriptKind;
}) {
  const { t } = useTranslation();
  const themed = useOptionalAppTheme();
  const layout = themed?.layout ?? parchmentLayout;
  const colors = themed?.colors ?? parchmentColors;
  const dark = themed?.dark ?? false;
  const {
    heading: numbered,
    custom: customTitle,
    label: a11y,
  } = chapterHeading(kind, number, chapter.title, (key, opts) => t(key, opts));
  // The prose as it stands: pending suggestions are not part of it yet.
  const preview = (chapter.summary.trim() || htmlToPlainText(htmlWithoutSuggestions(chapter.content))).trim();

  return (
    <View style={styles.file}>
      {/* The folder tab repeats the row's label, so VoiceOver skips it. */}
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.tab,
          { backgroundColor: selected ? colors.accent : colors.band },
        ]}
      >
        <Text style={[styles.tabText, { color: selected ? colors.onAccent : colors.bandInk }]}>
          {numbered.toUpperCase()}
        </Text>
      </View>
      <View
        style={[
          styles.sheet,
          {
            backgroundColor: colors.panel,
            borderColor: selected ? colors.accent : colors.line,
            borderWidth: selected ? 1.5 : 1,
          },
          dark ? null : styles.paperShadow,
        ]}
      >
        <View style={[styles.margin, { backgroundColor: alpha(colors.vermilion, 0.45) }]} />
        {/* The status picker holds its own buttons, so it sits beside the open target, not inside it. */}
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
          <TapPressable
            onPress={onOpen}
            accessibilityRole="button"
            accessibilityLabel={a11y}
            accessibilityState={{ selected }}
            style={{ flex: 1, minWidth: 0 }}
          >
            {customTitle ? <Text style={[styles.title, { color: colors.ink }]}>{customTitle}</Text> : null}
            <Text style={[styles.meta, { color: colors.inkSoft }]}>
              {t("chapters.wordCount", { count: chapter.wordCount }).toUpperCase()}
            </Text>
          </TapPressable>
          {onOpenHistory ? (
            <TapPressable
              feedback="dim"
              onPress={onOpenHistory}
              disabled={deleting}
              accessibilityRole="button"
              accessibilityLabel={t("history.openA11y", { title: customTitle ?? numbered })}
              style={[styles.action, { opacity: deleting ? 0.4 : 1 }]}
            >
              <VersionHistoryIcon color={colors.inkSoft} />
            </TapPressable>
          ) : null}
          <TapPressable
            feedback="dim"
            onPress={onRequestDelete}
            disabled={deleting}
            accessibilityRole="button"
            accessibilityLabel={t("chapters.deleteA11y", { title: customTitle ?? numbered })}
            style={[styles.action, { opacity: deleting ? 0.4 : 1 }]}
          >
            <TrashIcon color={colors.danger} />
          </TapPressable>
        </View>
        {preview ? (
          <TapPressable feedback="dim" onPress={onOpen} accessible={false}>
            <Text
              testID="chapter-preview"
              style={[styles.preview, { color: colors.inkSoft }]}
              numberOfLines={CHAPTER_PREVIEW_LINES}
              ellipsizeMode="tail"
            >
              {preview}
            </Text>
          </TapPressable>
        ) : null}
        {onStatusChange ? (
          <ChapterStatusPicker status={chapter.status} disabled={deleting} onChange={onStatusChange} />
        ) : null}
      </View>
    </View>
  );
}

// Each icon is a full 44pt target; the row's 8pt gap leaves the two glyphs well apart.
const styles = StyleSheet.create({
  file: { marginBottom: 16 },
  tab: {
    alignSelf: "flex-start",
    height: 22,
    paddingHorizontal: 12,
    justifyContent: "center",
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
  },
  tabText: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 1 },
  sheet: {
    borderTopLeftRadius: 0,
    borderTopRightRadius: 6,
    borderBottomLeftRadius: 6,
    borderBottomRightRadius: 6,
    paddingTop: 14,
    paddingBottom: 14,
    paddingLeft: 36,
    paddingRight: 8,
    overflow: "hidden",
  },
  paperShadow: {
    shadowColor: "#141414",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  margin: { position: "absolute", left: 22, top: 0, bottom: 0, width: 1 },
  title: {
    fontFamily: fonts.display,
    fontSize: 25,
    lineHeight: 28,
    letterSpacing: -0.4,
  },
  meta: { marginTop: 6, fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 0.8 },
  preview: { marginTop: 10, marginRight: 8, fontFamily: fonts.displayRegular, fontSize: 15.5, lineHeight: 22 },
  action: {
    width: 44,
    height: 44,
    marginTop: -10,
    alignItems: "center",
    justifyContent: "center",
  },
});
