import { useCallback, useEffect, useRef } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useTranslation } from "react-i18next";
import { useOptionalAppTheme } from "../lib/settings";
import { colors as parchmentColors, fonts } from "../lib/theme";
import { alpha } from "./Glass";
import {
  SCREENPLAY_ELEMENTS,
  cycleElement,
  type ScreenplayElement,
} from "../lib/manuscript-kind";
import { BetaBadge } from "./BetaBadge";
import { SelectChip, SelectLabel } from "./SelectChip";
import { TapPressable } from "./TapPressable";

/** Air a lit chip keeps from the row's left edge, and from the fade on its right, before the row moves it. */
const REVEAL_EDGE = 8;
const REVEAL_FADE = 40;

/** The i18n key of each element's label. */
export const ELEMENT_LABEL_KEYS: Record<ScreenplayElement, string> = {
  "scene-heading": "screenplay.sceneHeading",
  action: "screenplay.action",
  character: "screenplay.character",
  dialogue: "screenplay.dialogue",
  parenthetical: "screenplay.parenthetical",
  transition: "screenplay.transition",
  shot: "screenplay.shot",
  centered: "screenplay.centered",
};

/**
 * The phone's Tab key: pick the screenplay element of the block under the
 * caret, or step to the next one. Return starts the element that follows. It
 * sits just above the keyboard, where the thumb is.
 */
export function ScreenplayBar({
  element,
  dual = null,
  disabled = false,
  onSetElement,
  onToggleDual,
  testID = "screenplay-bar",
}: {
  /** The element of the line under the caret; null for one this build does not know. */
  element: ScreenplayElement | null;
  /**
   * The caret's speech and dual dialogue: null when there is nothing to
   * toggle (not in a speech, or none right above to sit beside), else whether
   * it already sits beside the one above.
   */
  dual?: { on: boolean } | null;
  disabled?: boolean;
  onSetElement: (element: ScreenplayElement) => void;
  onToggleDual?: () => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  const themed = useOptionalAppTheme();
  const colors = themed?.colors ?? parchmentColors;

  function press(next: ScreenplayElement) {
    if (disabled) return;
    onSetElement(next);
  }

  // The chips run on past the edge, so the lit one may be out of sight: when the element
  // changes, bring it to the middle, but only if it is not already comfortably in view (the
  // row stays put between neighbours, so a chip does not move under a thumb on its way to
  // it). Not animated on first show, which just opens there.
  const scroller = useRef<ScrollView>(null);
  const chipBox = useRef<Partial<Record<ScreenplayElement, { x: number; width: number }>>>({});
  const viewport = useRef(0);
  const content = useRef(0);
  const offset = useRef(0);
  const shown = useRef<ScreenplayElement | null | undefined>(undefined);
  const reveal = useCallback((el: ScreenplayElement | null, animated: boolean) => {
    const box = el ? chipBox.current[el] : undefined;
    if (!box || !viewport.current) return;
    const inView =
      box.x >= offset.current + REVEAL_EDGE && box.x + box.width <= offset.current + viewport.current - REVEAL_FADE;
    if (inView) return;
    const x = box.x + box.width / 2 - viewport.current / 2;
    scroller.current?.scrollTo({ x: Math.max(0, Math.min(x, content.current - viewport.current)), animated });
  }, []);
  useEffect(() => {
    if (shown.current === element) return;
    reveal(element, shown.current !== undefined);
    shown.current = element;
  }, [element, reveal]);

  return (
    <View
      testID={testID}
      accessibilityRole="toolbar"
      accessibilityLabel={t("screenplay.bar")}
      style={[
        styles.row,
        {
          borderTopColor: colors.line,
          backgroundColor: alpha(colors.bg, 0.92),
        },
      ]}
    >
      <BetaBadge />
      <View style={styles.scroller}>
        <ScrollView
          ref={scroller}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="always"
          contentContainerStyle={styles.chips}
          onLayout={(e) => {
            viewport.current = e.nativeEvent.layout.width;
            reveal(element, false);
          }}
          scrollEventThrottle={16}
          onScroll={(e) => {
            offset.current = e.nativeEvent.contentOffset.x;
          }}
          onContentSizeChange={(width) => {
            content.current = width;
            reveal(element, false);
          }}
        >
          {SCREENPLAY_ELEMENTS.map((el) => {
            const active = el === element;
            return (
              <View
                key={el}
                onLayout={(e) => {
                  chipBox.current[el] = { x: e.nativeEvent.layout.x, width: e.nativeEvent.layout.width };
                }}
              >
                <SelectChip
                  selected={active}
                  tokens={{
                    restFill: "transparent",
                    activeFill: colors.accent,
                    restBorder: "transparent",
                    activeBorder: colors.accent,
                    restText: colors.ink,
                    activeText: colors.bg,
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={t(ELEMENT_LABEL_KEYS[el])}
                  accessibilityState={{ selected: active, disabled }}
                  disabled={disabled}
                  onPress={() => press(el)}
                  style={{ opacity: disabled ? 0.4 : 1 }}
                  surfaceStyle={styles.chip}
                >
                  <SelectLabel style={{ fontFamily: fonts.sans, fontSize: 13, fontWeight: "600" }}>
                    {t(ELEMENT_LABEL_KEYS[el])}
                  </SelectLabel>
                </SelectChip>
              </View>
            );
          })}
          {onToggleDual ? (
            <SelectChip
              selected={dual?.on ?? false}
              tokens={{
                restFill: "transparent",
                activeFill: colors.accent,
                restBorder: colors.line,
                activeBorder: colors.accent,
                restText: colors.ink,
                activeText: colors.bg,
              }}
              accessibilityRole="button"
              accessibilityLabel={t("screenplay.dual")}
              accessibilityHint={t("screenplay.dualHint")}
              accessibilityState={{ selected: dual?.on ?? false, disabled: disabled || !dual }}
              disabled={disabled || !dual}
              onPress={() => onToggleDual()}
              style={{ opacity: disabled || !dual ? 0.4 : 1 }}
              surfaceStyle={styles.chip}
            >
              <SelectLabel style={{ fontFamily: fonts.sans, fontSize: 13, fontWeight: "600" }}>
                {t("screenplay.dual")}
              </SelectLabel>
            </SelectChip>
          ) : null}
        </ScrollView>
        {/* Chips run on past the edge; the fade says there are more. */}
        <LinearGradient
          pointerEvents="none"
          colors={[alpha(colors.bg, 0), colors.bg]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.fade}
        />
      </View>
      <TapPressable
        feedback="dim"
        accessibilityRole="button"
        accessibilityLabel={t("screenplay.next")}
        disabled={disabled}
        onPress={() => press(cycleElement(element ?? "action"))}
        style={[
          styles.next,
          { opacity: disabled ? 0.4 : 1 },
        ]}
      >
        <Text
          style={{
            fontFamily: fonts.sans,
            fontSize: 13,
            fontWeight: "700",
            color: colors.accent,
          }}
        >
          Tab
        </Text>
      </TapPressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingLeft: 12,
    paddingRight: 4,
    minHeight: 44,
  },
  scroller: { flex: 1, alignSelf: "stretch", justifyContent: "center", marginLeft: 8 },
  fade: { position: "absolute", top: 0, bottom: 0, right: 0, width: 28 },
  // The right padding is the fade's width, so the last chip can scroll clear of it.
  chips: { alignItems: "center", gap: 4, paddingVertical: 4, paddingRight: 28 },
  chip: {
    paddingHorizontal: 10,
    height: 32,
    borderRadius: 10,
    justifyContent: "center",
  },
  next: { paddingHorizontal: 12, height: 44, justifyContent: "center" },
});
