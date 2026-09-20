import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { ChapterStatusPicker } from "./ChapterStatusPicker";
import { chapterNumberLabel, customChapterTitle, CHAPTER_PREVIEW_LINES } from "../lib/chapter-label";
import { htmlToPlainText } from "../lib/html";
import type { ChapterStatus } from "../lib/chapter-status";
import { useOptionalAppTheme } from "../lib/settings";
import { colors as parchmentColors, layout as parchmentLayout } from "../lib/theme";
import type { Chapter } from "../lib/types";
import { TrashIcon } from "./icons";

export function ChapterListCard({
  chapter,
  number,
  selected,
  deleting = false,
  onOpen,
  onRequestDelete,
  onStatusChange,
}: {
  chapter: Chapter;
  /** 1-based index in the live chapter list. */
  number: number;
  selected: boolean;
  deleting?: boolean;
  onOpen: () => void;
  onRequestDelete: () => void;
  onStatusChange?: (status: ChapterStatus) => void;
}) {
  const { t } = useTranslation();
  const themed = useOptionalAppTheme();
  const layout = themed?.layout ?? parchmentLayout;
  const colors = themed?.colors ?? parchmentColors;
  const numbered = chapterNumberLabel(number, (key, opts) => t(key, opts));
  const customTitle = customChapterTitle(chapter.title, numbered, t("chapters.newTitle"));
  const a11y = customTitle ? `${numbered}, ${customTitle}` : numbered;
  const preview = (chapter.summary.trim() || htmlToPlainText(chapter.content)).trim();

  return (
    <View
      style={[
        layout.card,
        selected ? { borderColor: colors.accent, backgroundColor: colors.accentSoft } : null,
        { flexDirection: "row", alignItems: "flex-start", gap: 8 },
      ]}
    >
      <Pressable
        style={{ flex: 1, minWidth: 0 }}
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={a11y}
      >
        <Text style={layout.cardTitle}>{numbered}</Text>
        {customTitle ? <Text style={layout.cardMeta}>{customTitle}</Text> : null}
        <Text style={layout.cardMeta}>{t("chapters.wordCount", { count: chapter.wordCount })}</Text>
        {onStatusChange ? (
          <ChapterStatusPicker
            status={chapter.status}
            disabled={deleting}
            onChange={onStatusChange}
          />
        ) : null}
        {preview ? (
          <Text
            testID="chapter-preview"
            style={layout.cardMeta}
            numberOfLines={CHAPTER_PREVIEW_LINES}
            ellipsizeMode="tail"
          >
            {preview}
          </Text>
        ) : null}
      </Pressable>
      <Pressable
        onPress={onRequestDelete}
        disabled={deleting}
        accessibilityRole="button"
        accessibilityLabel={t("chapters.deleteA11y", { title: customTitle ?? numbered })}
        hitSlop={8}
        style={({ pressed }) => [
          {
            width: 38,
            height: 38,
            alignItems: "center",
            justifyContent: "center",
            opacity: deleting ? 0.4 : pressed ? 0.5 : 1,
          },
        ]}
      >
        <TrashIcon color={colors.danger} />
      </Pressable>
    </View>
  );
}