import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import type { EditMode } from "../lib/edit-mode";
import { useAppTheme } from "../lib/settings";
import { useReduceMotion } from "../lib/use-reduce-motion";
import * as haptics from "../lib/haptics";
import { Glass } from "./Glass";

const MODES: EditMode[] = ["edits", "chat"];
const SPRING = { damping: 15, stiffness: 190, mass: 0.7 } as const;

/**
 * The chat's two-state switch between Allow edits and Chat only. The
 * conversation owns the choice (useCiciroChat); the server enforces it per turn.
 */
export function EditModeToggle({
  mode,
  onChange,
}: {
  mode: EditMode;
  onChange: (mode: EditMode) => void;
}) {
  const { t } = useTranslation();
  const { colors, dark } = useAppTheme();
  const reduceMotion = useReduceMotion();
  const activeIndex = MODES.indexOf(mode);
  const pill = useSharedValue(activeIndex);
  const frames = useSharedValue(MODES.map(() => ({ x: 0, width: 0 })));

  useEffect(() => {
    pill.value = reduceMotion ? activeIndex : withSpring(activeIndex, SPRING);
  }, [activeIndex, reduceMotion, pill]);

  const pillStyle = useAnimatedStyle(() => {
    const [a, b] = frames.value;
    const p = pill.value;
    const x = a.x + (b.x - a.x) * p;
    const left = Math.max(x, a.x);
    const right = Math.min(x + a.width + (b.width - a.width) * p, b.x + b.width);
    return {
      width: Math.max(right - left, 0),
      transform: [{ translateX: left }],
    };
  });

  return (
    <Glass dark={dark} colors={colors} radius={14}>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={t("ciciroTab.editMode.label")}
        style={styles.row}
      >
        <Animated.View
          pointerEvents="none"
          style={[styles.bubble, { backgroundColor: colors.accentSoft }, pillStyle]}
        />
        {MODES.map((value, index) => {
          const selected = mode === value;
          return (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={t(`ciciroTab.editMode.${value}`)}
              accessibilityHint={t(`ciciroTab.editMode.${value}Hint`)}
              onPress={() => {
                if (!selected) {
                  haptics.select();
                  onChange(value);
                }
              }}
              onLayout={(e) => {
                const { x, width } = e.nativeEvent.layout;
                frames.value = frames.value.map((frame, i) => (i === index ? { x, width } : frame));
              }}
              style={styles.option}
            >
              <Text
                numberOfLines={1}
                style={{
                  color: selected ? colors.accent : colors.inkSoft,
                  fontSize: 13,
                  fontWeight: selected ? "600" : "400",
                }}
              >
                {t(`ciciroTab.editMode.${value}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </Glass>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", padding: 3, gap: 2 },
  option: { paddingHorizontal: 11, paddingVertical: 4, borderRadius: 11 },
  bubble: { position: "absolute", top: 3, bottom: 3, left: 0, borderRadius: 11 },
});
