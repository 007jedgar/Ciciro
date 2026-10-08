import { StyleSheet, Text, View } from "react-native";
import Animated, { interpolate, interpolateColor, useAnimatedStyle } from "react-native-reanimated";
import { CheckIcon } from "../icons";
import { PressableCard } from "../PressableCard";
import { useAppTheme } from "../../lib/settings";
import { useReduceMotion } from "../../lib/use-reduce-motion";
import { useSelectionPop } from "../../lib/use-selection-pop";

/**
 * A card you can tick on and off, for a question that takes several answers:
 * the border and tint crossfade to the accent and the check eases in (and back
 * out) when it flips.
 */
export function ChoiceCard({
  title,
  description,
  selected,
  onPress,
}: {
  title: string;
  description: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors, layout } = useAppTheme();
  const reduceMotion = useReduceMotion();
  // Only the crossfade: the shared hook's pop (a scale overshoot with a spring)
  // is too much recoil for a list of cards you tick one after another.
  const { progress } = useSelectionPop(selected, reduceMotion);

  const frame = useAnimatedStyle(() => ({
    borderColor: interpolateColor(progress.value, [0, 1], [colors.line, colors.accent]),
  }));
  const tint = useAnimatedStyle(() => ({ opacity: interpolate(progress.value, [0, 1], [0, 0.1]) }));
  const check = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: interpolate(progress.value, [0, 1], [0.4, 1]) }],
  }));

  return (
    <Animated.View style={frame}>
      <PressableCard
        onPress={onPress}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected }}
        accessibilityLabel={title}
        accessibilityHint={description}
        style={[layout.card, styles.card, { borderWidth: 0 }]}
      >
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.accent, borderRadius: 10 }, tint]}
        />
        <View style={{ flex: 1 }}>
          <Text style={layout.cardTitle}>{title}</Text>
          <Text style={layout.cardMeta}>{description}</Text>
        </View>
        <View style={[styles.box, { borderColor: colors.field }]}>
          <Animated.View style={[styles.checked, { backgroundColor: colors.accent }, check]}>
            <CheckIcon color={colors.onAccent} size={13} />
          </Animated.View>
        </View>
      </PressableCard>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 0, overflow: "hidden" },
  box: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5 },
  checked: {
    position: "absolute",
    top: -1.5,
    left: -1.5,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
});
