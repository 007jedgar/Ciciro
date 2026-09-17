import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { ChapterStatusPicker } from "./ChapterStatusPicker";
import type { ChapterStatus } from "../lib/chapter-status";
import { useOptionalAppTheme } from "../lib/settings";
import { colors as parchmentColors, layout as parchmentLayout } from "../lib/theme";
import type { Chapter } from "../lib/types";
import { TrashIcon } from "./icons";

export function ChapterListCard({
  chapter,
  selected,
  deleting = false,
  onOpen,
  onRequestDelete,
  onStatusChange,
}: {
  chapter: Chapter;
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
  const title = chapter.title || t("chapters.newTitle");

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
        accessibilityLabel={title}
      >
        <Text style={layout.cardTitle}>{title}</Text>
        <Text style={layout.cardMeta}>{t("chapters.wordCount", { count: chapter.wordCount })}</Text>
        {onStatusChange ? (
          <ChapterStatusPicker
            status={chapter.status}
            disabled={deleting}
            onChange={onStatusChange}
          />
        ) : null}
        {chapter.summary ? <Text style={layout.cardMeta}>{chapter.summary}</Text> : null}
      </Pressable>
      <Pressable
        onPress={onRequestDelete}
        disabled={deleting}
        accessibilityRole="button"
        accessibilityLabel={t("chapters.deleteA11y", { title })}
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