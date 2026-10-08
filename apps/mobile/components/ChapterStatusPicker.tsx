import { StyleSheet, Text, View } from "react-native";
import Animated, { interpolateColor, useAnimatedStyle } from "react-native-reanimated";
import { alpha } from "./Glass";
import { TapPressable } from "./TapPressable";
import { useTranslation } from "react-i18next";
import {
  CHAPTER_STATUSES,
  normalizeChapterStatus,
  type ChapterStatus,
} from "../lib/chapter-status";
import { useOptionalAppTheme } from "../lib/settings";
import { colors as parchmentColors, fonts } from "../lib/theme";
import { useReduceMotion } from "../lib/use-reduce-motion";
import { useSelectionPop } from "../lib/use-selection-pop";

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
  const reduceMotion = useReduceMotion();
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
      {CHAPTER_STATUSES.map((value) => (
        <StatusChip
          key={value}
          active={value === current}
          disabled={disabled}
          label={t(`chapters.status.${value}`)}
          fill={stock[value].fill}
          activeText={stock[value].text}
          inactiveText={colors.inkSoft}
          lineColor={colors.line}
          reduceMotion={reduceMotion}
          onPress={() => {
            if (!disabled && value !== current) onChange(value);
          }}
        />
      ))}
    </View>
  );
}

function StatusChip({
  active,
  disabled,
  label,
  fill,
  activeText,
  inactiveText,
  lineColor,
  reduceMotion,
  onPress,
}: {
  active: boolean;
  disabled: boolean;
  label: string;
  fill: string;
  activeText: string;
  inactiveText: string;
  lineColor: string;
  reduceMotion: boolean;
  onPress: () => void;
}) {
  const { progress, scale } = useSelectionPop(active, reduceMotion);

  const clearFill = alpha(fill, 0);
  const chipStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], [clearFill, fill]),
    borderColor: interpolateColor(progress.value, [0, 1], [lineColor, fill]),
    transform: [{ scale: scale.value }],
  }));
  const textStyle = useAnimatedStyle(() => ({
    color: interpolateColor(progress.value, [0, 1], [inactiveText, activeText]),
  }));

  return (
    <TapPressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled }}
      accessibilityLabel={label}
      hitSlop={6}
      style={[{ opacity: disabled ? 0.4 : 1 }]}
    >
      <Animated.View style={[styles.chip, active ? undefined : styles.chipInactive, chipStyle]}>
        <Animated.Text style={[styles.text, textStyle]}>{label.toUpperCase()}</Animated.Text>
      </Animated.View>
    </TapPressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 12 },
  chip: { borderWidth: 1, borderRadius: 3, paddingHorizontal: 8, paddingVertical: 4 },
  chipInactive: { borderStyle: "dashed" },
  text: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 0.8 },
});
