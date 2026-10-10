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

/** The i18n key of each element's label. */
export const ELEMENT_LABEL_KEYS: Record<ScreenplayElement, string> = {
  "scene-heading": "screenplay.sceneHeading",
  action: "screenplay.action",
  character: "screenplay.character",
  dialogue: "screenplay.dialogue",
  parenthetical: "screenplay.parenthetical",
  transition: "screenplay.transition",
  shot: "screenplay.shot",
};

/**
 * The phone's Tab key: pick the screenplay element of the block under the
 * caret, or step to the next one. Return starts the element that follows. It
 * sits just above the keyboard, where the thumb is.
 */
export function ScreenplayBar({
  element,
  disabled = false,
  onSetElement,
  testID = "screenplay-bar",
}: {
  /** The element of the line under the caret; null for one this build does not know. */
  element: ScreenplayElement | null;
  disabled?: boolean;
  onSetElement: (element: ScreenplayElement) => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  const themed = useOptionalAppTheme();
  const colors = themed?.colors ?? parchmentColors;

  function press(next: ScreenplayElement) {
    if (disabled) return;
    onSetElement(next);
  }

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
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="always"
          contentContainerStyle={styles.chips}
        >
          {SCREENPLAY_ELEMENTS.map((el) => {
            const active = el === element;
            return (
              <SelectChip
                key={el}
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
            );
          })}
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
  chips: { alignItems: "center", gap: 4, paddingVertical: 4 },
  chip: {
    paddingHorizontal: 10,
    height: 32,
    borderRadius: 10,
    justifyContent: "center",
  },
  next: { paddingHorizontal: 12, height: 44, justifyContent: "center" },
});
