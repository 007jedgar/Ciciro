import type { ReactNode } from "react";
import { Pressable, StyleSheet, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { mixColors } from "../lib/color";
import { useReduceMotion } from "../lib/use-reduce-motion";
import * as haptics from "../lib/haptics";
import { useOptionalAppTheme } from "../lib/settings";
import { colors as parchmentColors } from "../lib/theme";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const PRESSED_SCALE = 0.98;
const PRESSED_OPACITY = 0.92;
/** How far an accent card darkens (or lightens, in dark themes) under a finger. */
const ACCENT_PRESS_MIX = 0.2;

/**
 * An accent card's fill while pressed: the accent nudged toward the ink colour.
 * Ink is the far side of the theme from the panel colour the label is drawn in,
 * so the label only gains contrast.
 */
export function accentPressedColor(accent: string, ink: string): string {
  return mixColors(accent, ink, ACCENT_PRESS_MIX);
}
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
 * The app's shared pressable surface: a button-like card that dips in scale,
 * eases to .92 opacity and shifts to the theme's pressed tint while a finger is
 * down. An accent card moves toward the ink colour instead of toward its soft
 * tint, so the label (drawn in the panel colour) keeps its contrast while
 * pressed. Reduce motion drops the scale and keeps only the (instant) tint, so
 * touch is still acknowledged.
 */
export function PressableCard({ style, accent, children, onPress, onPressIn, onPressOut, disabled, ...rest }: Props) {
  const colors = useOptionalAppTheme()?.colors ?? parchmentColors;
  const reduceMotion = useReduceMotion();
  const pressed = useSharedValue(0);
  const flat = StyleSheet.flatten(style);
  const restOpacity = typeof flat?.opacity === "number" ? flat.opacity : 1;
  const base = accent ? colors.accent : flat?.backgroundColor;
  const from = typeof base === "string" ? base : colors.panel;
  const to = accent ? accentPressedColor(colors.accent, colors.ink) : colors.panel2;

  const animated = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(pressed.value, [0, 1], [from, to]),
    opacity: restOpacity * (reduceMotion ? 1 : 1 - (1 - PRESSED_OPACITY) * pressed.value),
    transform: [{ scale: reduceMotion ? 1 : 1 - (1 - PRESSED_SCALE) * pressed.value }],
  }));

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPress={onPress ? haptics.withTap(onPress) : undefined}
      onPressIn={(e) => {
        pressed.value = withTiming(1, { duration: reduceMotion ? 0 : PRESS_IN_MS, easing: Easing.out(Easing.quad) });
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        pressed.value = withTiming(0, { duration: reduceMotion ? 0 : PRESS_OUT_MS, easing: Easing.out(Easing.quad) });
        onPressOut?.(e);
      }}
      style={[style, accent && { borderColor: colors.accent }, animated]}
    >
      {children}
    </AnimatedPressable>
  );
}
