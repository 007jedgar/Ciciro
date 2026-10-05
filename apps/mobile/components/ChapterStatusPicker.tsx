import { StyleSheet, Text, View } from "react-native";
import { TapPressable } from "./TapPressable";
import { useTranslation } from "react-i18next";
import {
  CHAPTER_STATUSES,
  normalizeChapterStatus,
  type ChapterStatus,
} from "../lib/chapter-status";
import { useOptionalAppTheme } from "../lib/settings";
import { colors as parchmentColors, fonts } from "../lib/theme";

/**
 * Manuscript stage as paper stock: a draft is blush, a revised chapter butter,
 * a final one cobalt. The rest stay as dashed outlines, like the landing's chips.
 */
export function ChapterStatusPicker({
  status,
  disabled = false,
  onChange,
}: {
  status: string;
  disabled?: boolean;
  onChange: (status: ChapterStatus) => void;
}) {
  const { t } = useTranslation();
  const themed = useOptionalAppTheme();
  const colors = themed?.colors ?? parchmentColors;
  const current = normalizeChapterStatus(status);
  const stock: Record<ChapterStatus, { fill: string; text: string }> = {
    draft: { fill: colors.blush, text: colors.paperInk },
    revised: { fill: colors.butter, text: colors.paperInk },
    final: { fill: colors.accent, text: colors.onAccent },
  };

  return (
    <View
      accessibilityLabel={t("chapters.statusA11y", { status: t(`chapters.status.${current}`) })}
      style={styles.row}
    >
      {CHAPTER_STATUSES.map((value) => {
        const active = value === current;
        const label = t(`chapters.status.${value}`);
        return (
          <TapPressable
            key={value}
            onPress={() => {
              if (!disabled && value !== current) onChange(value);
            }}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityState={{ selected: active, disabled }}
            accessibilityLabel={label}
            hitSlop={6}
            style={({ pressed }) => [
              styles.chip,
              active
                ? { backgroundColor: stock[value].fill, borderColor: stock[value].fill }
                : { borderColor: colors.line, borderStyle: "dashed" },
              { opacity: disabled ? 0.4 : pressed ? 0.55 : 1 },
            ]}
          >
            <Text
              style={[
                styles.text,
                { color: active ? stock[value].text : colors.inkSoft },
              ]}
            >
              {label.toUpperCase()}
            </Text>
          </TapPressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 12 },
  chip: { borderWidth: 1, borderRadius: 3, paddingHorizontal: 8, paddingVertical: 4 },
  text: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 0.8 },
});
