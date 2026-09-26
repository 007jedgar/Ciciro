import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useTranslation } from "react-i18next";
import type { BlockKind } from "../lib/manuscript";
import type { BlockMark, BlockMarks } from "../lib/block-editor";
import { emptyBlockMarks } from "../lib/block-editor";
import { useOptionalAppTheme } from "../lib/settings";
import { colors as parchmentColors, fonts } from "../lib/theme";
import { alpha } from "./Glass";
import { FORMAT_BAR_HEIGHT } from "../lib/format-chrome";
import { MicIcon } from "./icons";

export type FormatBlockKind = Extract<
  BlockKind,
  "paragraph" | "heading" | "quote" | "list_item"
>;

type MarkBtn = {
  id: BlockMark;
  label: string;
  a11y: string;
};

type BlockBtn = {
  id: FormatBlockKind;
  label: string;
  a11y: string;
};

export function FormatBar({
  marks = emptyBlockMarks(),
  kind = "paragraph",
  placement = "header",
  disabled = false,
  onToggleMark,
  onSetKind,
  dictation,
  testID = "format-bar",
}: {
  marks?: BlockMarks;
  kind?: FormatBlockKind;
  placement?: "header" | "accessory";
  disabled?: boolean;
  onToggleMark: (mark: BlockMark) => void;
  onSetKind: (kind: FormatBlockKind) => void;
  /** Shows a microphone button when set. Omit where dictation is unavailable. */
  dictation?: { active: boolean; onToggle: () => void };
  testID?: string;
}) {
  const { t } = useTranslation();
  const themed = useOptionalAppTheme();
  const colors = themed?.colors ?? parchmentColors;

  const markBtns: MarkBtn[] = [
    { id: "bold", label: "B", a11y: t("manuscript.formatBold") },
    { id: "italic", label: "I", a11y: t("manuscript.formatItalic") },
    { id: "underline", label: "U", a11y: t("manuscript.formatUnderline") },
    { id: "strike", label: "S", a11y: t("manuscript.formatStrike") },
  ];
  const blockBtns: BlockBtn[] = [
    { id: "heading", label: "H", a11y: t("manuscript.formatHeading") },
    { id: "quote", label: "“", a11y: t("manuscript.formatQuote") },
    { id: "list_item", label: "•", a11y: t("manuscript.formatList") },
  ];

  function press(action: () => void) {
    if (disabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    action();
  }

  return (
    <View
      testID={testID}
      accessibilityRole="toolbar"
      accessibilityLabel={t("manuscript.formatBar")}
      style={[
        styles.row,
        placement === "header"
          ? {
              borderBottomColor: colors.line,
              borderBottomWidth: StyleSheet.hairlineWidth,
            }
          : {
              borderTopColor: colors.line,
              borderTopWidth: StyleSheet.hairlineWidth,
            },
        { backgroundColor: alpha(colors.bg, 0.92) },
      ]}
    >
      {markBtns.map((btn) => (
        <FormatMark
          key={btn.id}
          label={btn.label}
          a11y={btn.a11y}
          active={marks[btn.id]}
          italic={btn.id === "italic"}
          strike={btn.id === "strike"}
          underline={btn.id === "underline"}
          disabled={disabled}
          colors={colors}
          onPress={() => press(() => onToggleMark(btn.id))}
        />
      ))}
      <View style={[styles.gap, { backgroundColor: colors.line }]} />
      {blockBtns.map((btn) => (
        <FormatMark
          key={btn.id}
          label={btn.label}
          a11y={btn.a11y}
          active={kind === btn.id}
          disabled={disabled}
          colors={colors}
          onPress={() =>
            press(() => onSetKind(kind === btn.id ? "paragraph" : btn.id))
          }
        />
      ))}
      {dictation ? (
        <>
          <View style={[styles.gap, { backgroundColor: colors.line }]} />
          <Pressable
            testID="dictate-button"
            accessibilityRole="button"
            accessibilityLabel={
              dictation.active
                ? t("manuscript.dictateStop")
                : t("manuscript.dictate")
            }
            accessibilityState={{
              selected: dictation.active,
              disabled: disabled && !dictation.active,
            }}
            disabled={disabled && !dictation.active}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
                () => {},
              );
              dictation.onToggle();
            }}
            style={({ pressed }) => [
              styles.mark,
              {
                backgroundColor: dictation.active
                  ? colors.accentSoft
                  : "transparent",
                opacity:
                  disabled && !dictation.active ? 0.4 : pressed ? 0.65 : 1,
              },
            ]}
          >
            <MicIcon color={dictation.active ? colors.accent : colors.ink} />
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

export function FormatMark({
  label,
  a11y,
  active,
  italic,
  strike,
  underline,
  disabled,
  compact = false,
  colors,
  onPress,
  onPressIn,
}: {
  label: string;
  a11y: string;
  active: boolean;
  italic?: boolean;
  strike?: boolean;
  underline?: boolean;
  disabled: boolean;
  compact?: boolean;
  colors: { ink: string; accent: string; accentSoft: string };
  onPress?: () => void;
  onPressIn?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ selected: active, disabled }}
      onPress={onPress}
      onPressIn={onPressIn}
      disabled={disabled}
      style={({ pressed }) => [
        compact ? styles.markCompact : styles.mark,
        {
          backgroundColor: active ? colors.accentSoft : "transparent",
          opacity: disabled ? 0.4 : pressed ? 0.65 : 1,
        },
      ]}
    >
      <Text
        style={{
          fontFamily: fonts.sans,
          fontSize: compact ? 14 : 16,
          fontWeight: "600",
          fontStyle: italic ? "italic" : "normal",
          textDecorationLine: strike
            ? "line-through"
            : underline
              ? "underline"
              : "none",
          color: active ? colors.accent : colors.ink,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    minHeight: FORMAT_BAR_HEIGHT,
    gap: 2,
  },
  mark: {
    minWidth: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  markCompact: {
    minWidth: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  gap: {
    width: StyleSheet.hairlineWidth,
    height: 18,
    marginHorizontal: 8,
  },
});
