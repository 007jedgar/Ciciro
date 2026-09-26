import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { ChapterStatusPicker } from "./ChapterStatusPicker";
import { chapterHeading, CHAPTER_PREVIEW_LINES } from "../lib/chapter-label";
import type { ManuscriptKind } from "../lib/manuscript-kind";
import { htmlToPlainText } from "../lib/html";
import { htmlWithoutSuggestions } from "../lib/suggestions";
import type { ChapterStatus } from "../lib/chapter-status";
import { useOptionalAppTheme } from "../lib/settings";
import { colors as parchmentColors, layout as parchmentLayout } from "../lib/theme";
import type { Chapter } from "../lib/types";
import { TrashIcon, VersionHistoryIcon } from "./icons";

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
  const {
    heading: numbered,
    custom: customTitle,
    label: a11y,
  } = chapterHeading(kind, number, chapter.title, (key, opts) => t(key, opts));
  // The prose as it stands: pending suggestions are not part of it yet.
  const preview = (chapter.summary.trim() || htmlToPlainText(htmlWithoutSuggestions(chapter.content))).trim();

  return (
    <View
      style={[
        layout.card,
        selected ? { borderColor: colors.accent, backgroundColor: colors.accentSoft } : null,
      ]}
    >
      {/* The status picker holds its own buttons, so it sits beside the open target, not inside it. */}
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
        <Pressable
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityLabel={a11y}
          style={{ flex: 1, minWidth: 0 }}
        >
          <Text style={layout.cardTitle}>{numbered}</Text>
          {customTitle ? <Text style={layout.cardMeta}>{customTitle}</Text> : null}
          <Text style={layout.cardMeta}>{t("chapters.wordCount", { count: chapter.wordCount })}</Text>
        </Pressable>
        {onOpenHistory ? (
          <Pressable
            onPress={onOpenHistory}
            disabled={deleting}
            accessibilityRole="button"
            accessibilityLabel={t("history.openA11y", { title: customTitle ?? numbered })}
            style={({ pressed }) => [styles.action, { opacity: deleting ? 0.4 : pressed ? 0.5 : 1 }]}
          >
            <VersionHistoryIcon color={colors.inkSoft} />
          </Pressable>
        ) : null}
        <Pressable
          onPress={onRequestDelete}
          disabled={deleting}
          accessibilityRole="button"
          accessibilityLabel={t("chapters.deleteA11y", { title: customTitle ?? numbered })}
          style={({ pressed }) => [styles.action, { opacity: deleting ? 0.4 : pressed ? 0.5 : 1 }]}
        >
          <TrashIcon color={colors.danger} />
        </Pressable>
      </View>
      {onStatusChange ? (
        <ChapterStatusPicker status={chapter.status} disabled={deleting} onChange={onStatusChange} />
      ) : null}
      {preview ? (
        <Pressable onPress={onOpen} accessible={false}>
          <Text
            testID="chapter-preview"
            style={layout.cardMeta}
            numberOfLines={CHAPTER_PREVIEW_LINES}
            ellipsizeMode="tail"
          >
            {preview}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// Each icon is a full 44pt target; the row's 8pt gap leaves the two glyphs well apart.
const styles = StyleSheet.create({
  action: {
    width: 44,
    height: 44,
    marginTop: -8,
    alignItems: "center",
    justifyContent: "center",
  },
});
