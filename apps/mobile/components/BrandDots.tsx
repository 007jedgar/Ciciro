import { Pressable, StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";
import * as Haptics from "expo-haptics";

/**
 * The Ciciro mark: three dots (an ellipsis) in the app's accent. Vector, so it
 * stays crisp at any size. Tap plays a one-shot hop — left to right, then they
 * fall back — so the same mark can delight anywhere we show it.
 *
 * Geometry taken from the source logo's 1500x1500 art.
 */
const VB = 1500;
const CY = 750;
const R = 123.37;
const CX = [259.78, 750, 1240.22] as const;
const STAGGER_MS = 72;
const UP_MS = 150;
const DOWN_MS = 230;

function hop(
  y: SharedValue<number>,
  scale: SharedValue<number>,
  delay: number,
  jump: number,
) {
  cancelAnimation(y);
  cancelAnimation(scale);
  y.value = withDelay(
    delay,
    withSequence(
      withTiming(-jump, { duration: UP_MS, easing: Easing.out(Easing.cubic) }),
      withTiming(0, { duration: DOWN_MS, easing: Easing.in(Easing.cubic) }),
    ),
  );
  scale.value = withDelay(
    delay,
    withSequence(
      withTiming(1.16, { duration: UP_MS, easing: Easing.out(Easing.cubic) }),
      withTiming(1, { duration: DOWN_MS, easing: Easing.in(Easing.cubic) }),
    ),
  );
}

function Dot({
  left,
  top,
  diameter,
  color,
  y,
  scale,
}: {
  left: number;
  top: number;
  diameter: number;
  color: string;
  y: SharedValue<number>;
  scale: SharedValue<number>;
}) {
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }, { scale: scale.value }],
  }));
  return (
    <Animated.View style={[styles.dot, { left, top, width: diameter, height: diameter }, style]}>
      <Svg width={diameter} height={diameter} viewBox={`0 0 ${R * 2} ${R * 2}`}>
        <Circle cx={R} cy={R} r={R} fill={color} />
      </Svg>
    </Animated.View>
  );
}

export function BrandDots({
  size = 48,
  color = "#b4552d",
  interactive = true,
}: {
  size?: number;
  color?: string;
  /** When false, renders the static mark (e.g. a decorative overlay). */
  interactive?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const y0 = useSharedValue(0);
  const y1 = useSharedValue(0);
  const y2 = useSharedValue(0);
  const s0 = useSharedValue(1);
  const s1 = useSharedValue(1);
  const s2 = useSharedValue(1);

  const unit = size / VB;
  const r = R * unit;
  const diameter = r * 2;
  const jump = Math.max(12, size * 0.7);
  const ys = [y0, y1, y2];
  const scales = [s0, s1, s2];

  const play = () => {
    console.log("brand-dots-hop");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (reduceMotion) return;
    ys.forEach((y, i) => hop(y, scales[i]!, i * STAGGER_MS, jump));
  };

  const mark = (
    <View style={{ width: size, height: size, overflow: "visible" }} pointerEvents="none">
      {CX.map((cx, i) => (
        <Dot
          key={cx}
          left={cx * unit - r}
          top={CY * unit - r}
          diameter={diameter}
          color={color}
          y={ys[i]!}
          scale={scales[i]!}
        />
      ))}
    </View>
  );

  if (!interactive) return mark;

  const hit = Math.max(48, size);
  return (
    <Pressable
      onPress={play}
      accessibilityRole="image"
      accessibilityLabel="Ciciro"
      hitSlop={8}
      style={[styles.hit, { width: hit, height: hit }]}
    >
      {mark}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible",
  },
  dot: {
    position: "absolute",
  },
});
