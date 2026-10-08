import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

const DOT = 7;
const GAP = 7;
const CYCLE_MS = 1100;
/** How far behind the dot to its left each dot runs, as a fraction of a cycle. */
const PHASE = 0.16;
/** Lets the host finish fading the dots out before the wave stops mid-swell. */
const STOP_GRACE_MS = 260;

function swell(phase: number): number {
  "worklet";
  const wrapped = ((phase % 1) + 1) % 1;
  if (wrapped > 0.5) return 0;
  return Math.sin(wrapped * 2 * Math.PI) ** 2;
}

function InlineDot({ clock, index, color }: { clock: SharedValue<number>; index: number; color: string }) {
  const style = useAnimatedStyle(() => {
    const lift = swell(clock.value - index * PHASE);
    return { opacity: 0.45 + lift * 0.55, transform: [{ translateY: -lift * 4 }, { scale: 1 + lift * 0.14 }] };
  });
  return <Animated.View style={[styles.dot, { backgroundColor: color }, style]} />;
}

/**
 * The brand's three dots as an inline wait: the same swell-and-lift left to
 * right as the mark, small enough to sit where a button's label was. It takes
 * no layout change to appear, so a caller crossfades it over the label.
 */
export function InlineDots({
  color,
  active,
  reduceMotion = false,
}: {
  color: string;
  active: boolean;
  reduceMotion?: boolean;
}) {
  const clock = useSharedValue(0);

  useEffect(() => {
    if (!active || reduceMotion) return;
    clock.value = withRepeat(withTiming(1, { duration: CYCLE_MS, easing: Easing.linear }), -1, false);
    // Cleanup runs when `active` flips off: keep the wave going until the host's fade ends.
    return () => {
      setTimeout(() => cancelAnimation(clock), STOP_GRACE_MS);
    };
  }, [active, reduceMotion, clock]);

  return (
    <View style={styles.row} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {[0, 1, 2].map((index) => (
        <InlineDot key={index} clock={clock} index={index} color={color} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: GAP },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
});
