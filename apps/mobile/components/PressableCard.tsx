import type { ReactNode } from "react";
import { Pressable, StyleSheet, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useReduceMotion } from "../lib/use-reduce-motion";
import { useAppTheme } from "../lib/settings";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const PRESSED_SCALE = 0.98;
const PRESS_IN_MS = 90;
const PRESS_OUT_MS = 180;

type Props = Omit<PressableProps, "style" | "children"> & {
  /** Visual style of the surface; its backgroundColor is what the press highlight starts from. */
  style?: StyleProp<ViewStyle>;
  /** Filled accent style for primary actions. When true, backgroundColor is overridden to accent. */
  accent?: boolean;
  children?: ReactNode;
};

/**
 * The app's shared pressable surface: a button-like card that dips in scale and
 * shifts to the theme's pressed tint while a finger is down. Reduce motion drops
 * the scale and keeps only the (instant) tint, so touch is still acknowledged.
 */
export function PressableCard({ style, accent, children, onPressIn, onPressOut, disabled, ...rest }: Props) {
  const { colors } = useAppTheme();
  const reduceMotion = useReduceMotion();
  const pressed = useSharedValue(0);
  const base = accent ? colors.accent : StyleSheet.flatten(style)?.backgroundColor;
  const from = typeof base === "string" ? base : colors.panel;
  const to = accent ? colors.accentSoft : colors.panel2;

  const animated = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(pressed.value, [0, 1], [from, to]),
    transform: [{ scale: reduceMotion ? 1 : 1 - (1 - PRESSED_SCALE) * pressed.value }],
  }));

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={(e) => {
        pressed.value = withTiming(1, { duration: reduceMotion ? 0 : PRESS_IN_MS, easing: Easing.out(Easing.quad) });
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        pressed.value = withTiming(0, { duration: reduceMotion ? 0 : PRESS_OUT_MS, easing: Easing.out(Easing.quad) });
        onPressOut?.(e);
      }}
      style={[!accent && style, animated]}
    >
      {children}
    </AnimatedPressable>
  );
}
