import type { ReactNode } from "react";
import { Pressable, StyleSheet, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated from "react-native-reanimated";
import { mixColors } from "../lib/color";
import * as haptics from "../lib/haptics";
import { PRESS_SCALE, TINT_MIX } from "../lib/motion";
import { useOptionalAppTheme } from "../lib/settings";
import { colors as parchmentColors } from "../lib/theme";
import { pressTint, usePressFeedback } from "../lib/use-press-feedback";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * An accent card's fill while pressed: the accent nudged toward the ink colour.
 * Ink is the far side of the theme from the panel colour the label is drawn in,
 * so the label only gains contrast.
 */
export function accentPressedColor(accent: string, ink: string): string {
  return mixColors(accent, ink, TINT_MIX);
}
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
  const flat = StyleSheet.flatten(style);
  const restOpacity = typeof flat?.opacity === "number" ? flat.opacity : 1;
  const press = usePressFeedback({
    scale: PRESS_SCALE.card,
    restOpacity,
    tint: pressTint(style, colors, { accent, assumePanel: true }),
  });

  return (
    <AnimatedPressable
      accessibilityRole="button"
      {...rest}
      disabled={disabled}
      onPress={onPress ? haptics.withTap(onPress) : undefined}
      onPressIn={(e) => {
        press.onPressIn();
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        press.onPressOut();
        onPressOut?.(e);
      }}
      style={[style, accent && { borderColor: colors.accent }, press.animatedStyle]}
    >
      {children}
    </AnimatedPressable>
  );
}
