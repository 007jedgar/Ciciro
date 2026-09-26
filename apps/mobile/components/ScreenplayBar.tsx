import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useTranslation } from "react-i18next";
import { useOptionalAppTheme } from "../lib/settings";
import { colors as parchmentColors, fonts } from "../lib/theme";
import { alpha } from "./Glass";
import {
  SCREENPLAY_ELEMENTS,
  cycleElement,
  type ScreenplayElement,
} from "../lib/manuscript-kind";

const LABEL_KEYS: Record<ScreenplayElement, string> = {
  "scene-heading": "screenplay.sceneHeading",
  action: "screenplay.action",
  character: "screenplay.character",
  dialogue: "screenplay.dialogue",
  parenthetical: "screenplay.parenthetical",
  transition: "screenplay.transition",
};

/**
 * The phone's Tab key: pick the screenplay element of the block under the
 * caret, or step to the next one. Return starts the element that follows.
 */
export function ScreenplayBar({
  element,
  disabled = false,
  onSetElement,
  testID = "screenplay-bar",
}: {
  element: ScreenplayElement;
  disabled?: boolean;
  onSetElement: (element: ScreenplayElement) => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  const themed = useOptionalAppTheme();
  const colors = themed?.colors ?? parchmentColors;

  function press(next: ScreenplayElement) {
    if (disabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onSetElement(next);
  }

  return (
    <View
      testID={testID}
      accessibilityRole="toolbar"
      accessibilityLabel={t("screenplay.bar")}
      style={[
        styles.row,
        { borderBottomColor: colors.line, backgroundColor: alpha(colors.bg, 0.92) },
      ]}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        contentContainerStyle={styles.chips}
      >
        {SCREENPLAY_ELEMENTS.map((el) => {
          const active = el === element;
          return (
            <Pressable
              key={el}
              accessibilityRole="button"
              accessibilityLabel={t(LABEL_KEYS[el])}
              accessibilityState={{ selected: active, disabled }}
              disabled={disabled}
              onPress={() => press(el)}
              style={({ pressed }) => [
                styles.chip,
                {
                  backgroundColor: active ? colors.accentSoft : "transparent",
                  opacity: disabled ? 0.4 : pressed ? 0.65 : 1,
                },
              ]}
            >
              <Text
                style={{
                  fontFamily: fonts.sans,
                  fontSize: 13,
                  fontWeight: "600",
                  color: active ? colors.accent : colors.ink,
                }}
              >
                {t(LABEL_KEYS[el])}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("screenplay.next")}
        disabled={disabled}
        onPress={() => press(cycleElement(element))}
        style={({ pressed }) => [styles.next, { opacity: disabled ? 0.4 : pressed ? 0.65 : 1 }]}
      >
        <Text style={{ fontFamily: fonts.sans, fontSize: 13, fontWeight: "700", color: colors.accent }}>
          Tab
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingLeft: 12,
    paddingRight: 4,
    minHeight: 44,
  },
  chips: { alignItems: "center", gap: 4, paddingVertical: 4 },
  chip: { paddingHorizontal: 10, height: 32, borderRadius: 10, justifyContent: "center" },
  next: { paddingHorizontal: 12, height: 44, justifyContent: "center" },
});
