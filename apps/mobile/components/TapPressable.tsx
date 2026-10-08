import { forwardRef } from "react";
import { Pressable, StyleSheet, type PressableProps, type StyleProp, type View, type ViewStyle } from "react-native";
import Animated from "react-native-reanimated";
import * as haptics from "../lib/haptics";
import { useOptionalAppTheme } from "../lib/settings";
import { colors as parchmentColors } from "../lib/theme";
import { pressTint, rowHighlightTint, usePressFeedback, type PressFeedback } from "../lib/use-press-feedback";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = Omit<PressableProps, "style"> & {
  /** A plain style: the press is the shared engine's job, so there is no `({ pressed })` form. */
  style?: StyleProp<ViewStyle>;
  /**
   * How it answers a finger (`lib/use-press-feedback.ts`). `scale` (default) is for anything with a surface: a
   * button, pill, chip or row. `dim` is for a bare text link or icon. `none` is for a scrim or a wrapper whose
   * children already respond.
   */
  feedback?: PressFeedback;
  /** Pressed scale for `feedback="scale"`: `PRESS_SCALE.button` (default), `.card`, `.chip` or `.fab`. */
  scale?: number;
  /** A full-bleed list row: fade `panel2` in under the finger. Use with `feedback="none"` so it lights up, not shrinks. */
  highlight?: boolean;
  /**
   * The haptic on press: the light `tap` for a button (default), the `select` detent for choosing among options,
   * or `none` when the handler gives its own (a result haptic such as `success`).
   */
  haptic?: "tap" | "select" | "none";
};

/**
 * The app's shared button: a `Pressable` that gives the light haptic tap on
 * press and the shared press feedback (scale, dim and tint) while a finger is
 * down. VoiceOver announces it as a button unless the caller names another
 * role (tab, radio, link).
 */
export const TapPressable = forwardRef<View, Props>(function TapPressable(
  { onPress, onPressIn, onPressOut, style, feedback = "scale", scale, highlight, haptic = "tap", ...rest },
  ref
) {
  const colors = useOptionalAppTheme()?.colors ?? parchmentColors;
  const flat = StyleSheet.flatten(style);
  const restOpacity = typeof flat?.opacity === "number" ? flat.opacity : 1;
  const tint = highlight ? rowHighlightTint(style, colors) : feedback === "scale" ? pressTint(style, colors) : null;
  const press = usePressFeedback({ feedback, scale, restOpacity, tint });

  return (
    <AnimatedPressable
      ref={ref}
      accessibilityRole="button"
      {...rest}
      onPress={onPress && haptic === "tap" ? haptics.withTap(onPress) : onPress && haptic === "select" ? haptics.withSelect(onPress) : onPress}
      onPressIn={(event) => {
        press.onPressIn();
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        press.onPressOut();
        onPressOut?.(event);
      }}
      style={feedback === "none" && !tint ? style : [style, press.animatedStyle]}
    />
  );
});
