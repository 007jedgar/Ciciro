import { useEffect } from "react";
import { StyleSheet, View, type TextStyle } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { shimmerBrightness } from "../lib/shimmer";

const CYCLE_MS = 1_900;

/**
 * One character of the label. Each is its own Text rather than a run nested in
 * a parent, because animated colour is reliable on a standalone Text and the
 * label is a short single line where laying characters out in a row costs
 * nothing.
 */
function Letter({
  char,
  index,
  count,
  clock,
  rest,
  lit,
  style,
}: {
  char: string;
  index: number;
  count: number;
  clock: SharedValue<number>;
  rest: string;
  lit: string;
  style: TextStyle;
}) {
  const animated = useAnimatedStyle(() => ({
    color: interpolateColor(
      shimmerBrightness(clock.value, index, count),
      [0, 1],
      [rest, lit]
    ),
  }));
  return (
    <Animated.Text style={[style, { color: rest }, animated]}>{char}</Animated.Text>
  );
}

/**
 * A status line with the theme's accent travelling through it, left to right.
 *
 * Used while Ciciro is working: the words themselves carry the sense of
 * something in progress, so the label is doing the job a spinner would without
 * adding another moving part to the screen.
 */
export function ShimmerText({
  text,
  rest,
  lit,
  style,
  reduceMotion = false,
  decorative = false,
}: {
  text: string;
  /** The label's settled colour. */
  rest: string;
  /** The colour at the crest of the sweep — the theme's accent. */
  lit: string;
  style?: TextStyle;
  reduceMotion?: boolean;
  /**
   * Set when the surrounding element already announces this text — the
   * characters are then a rendering detail, and a screen reader should not read
   * the label twice.
   */
  decorative?: boolean;
}) {
  const clock = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      clock.value = 0;
      return;
    }
    clock.value = 0;
    clock.value = withRepeat(
      withTiming(1, { duration: CYCLE_MS, easing: Easing.linear }),
      -1,
      false
    );
    return () => cancelAnimation(clock);
    // Restarting on a new label keeps the sweep in step with the words shown.
  }, [clock, reduceMotion, text]);

  const base: TextStyle = { fontSize: 13, ...style };
  const chars = [...text];

  if (reduceMotion) {
    return (
      <Animated.Text
        style={[base, { color: rest }]}
        accessibilityElementsHidden={decorative}
        importantForAccessibility={decorative ? "no-hide-descendants" : "yes"}
      >
        {text}
      </Animated.Text>
    );
  }

  return (
    <View
      style={styles.row}
      accessible={!decorative}
      accessibilityLabel={decorative ? undefined : text}
      accessibilityElementsHidden={decorative}
      importantForAccessibility={decorative ? "no-hide-descendants" : "yes"}
    >
      {chars.map((char, index) => (
        <Letter
          key={`${index}:${char}`}
          char={char}
          index={index}
          count={chars.length}
          clock={clock}
          rest={rest}
          lit={lit}
          style={base}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // Nowrap: a status line is one line, and a long tool name clips rather than
  // reflowing the mark beside it.
  row: { flexDirection: "row", flexWrap: "nowrap", flexShrink: 1, overflow: "hidden" },
});
