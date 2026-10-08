import { useCallback, useMemo } from "react";
import type { GestureResponderEvent, StyleProp, ViewStyle } from "react-native";
import { StyleSheet } from "react-native";
import { interpolateColor, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import { mixColors } from "./color";
import { PRESS_DIM, PRESS_EASE, PRESS_IN_MS, PRESS_OUT_MS, PRESS_SCALE, TINT_MIX } from "./motion";
import { useReduceMotion } from "./use-reduce-motion";

/**
 * How a pressable answers a finger.
 * - `scale`: dips in scale, eases to `PRESS_DIM.surface` opacity and (when it has a solid fill) tints.
 * - `dim`: opacity only, `PRESS_DIM.link`, for a bare text link or icon with no surface to scale.
 * - `none`: nothing visual (a scrim, a wrapper whose children already respond).
 */
export type PressFeedback = "scale" | "dim" | "none";

export type PressTint = { from: string; to: string };

type Options = {
  feedback?: PressFeedback;
  /** Pressed scale for `scale` (default `PRESS_SCALE.button`); see `PRESS_SCALE`. */
  scale?: number;
  /** Pressed opacity override; defaults to the `PRESS_DIM` value for the feedback kind. */
  dim?: number;
  /** The surface's own rest opacity (a disabled button at .45), which the press dims from. */
  restOpacity?: number;
  /** Fill colours to ease between; omit for a surface with no solid fill. */
  tint?: PressTint | null;
  /** Release duration override (the tab-bar FAB lets go faster). */
  outMs?: number;
};

export type PressFeedbackHandle = {
  /** 0 at rest, 1 fully pressed; for a caller that drives its own extra motion off the press. */
  pressed: SharedValue<number>;
  /** Merge after the surface's own style. Empty for `feedback="none"`. */
  animatedStyle: ReturnType<typeof useAnimatedStyle>;
  onPressIn: (event?: GestureResponderEvent) => void;
  onPressOut: (event?: GestureResponderEvent) => void;
};

/**
 * The one press-feedback engine: `PressableCard`, `TapPressable`, the auth
 * submit and the tab-bar plus button all drive off this, so the timing, the
 * scale/dim values and the reduce-motion rule live in one place (`lib/motion.ts`).
 * Reduce motion drops the scale and the eased timing but keeps the dim and the
 * tint (an instant swap), so a touch is still acknowledged.
 *
 * Numbers are read into locals before the worklet so the UI runtime captures
 * them by value (an imported constant used inside a worklet can be missing).
 */
export function usePressFeedback({
  feedback = "scale",
  scale,
  dim,
  restOpacity = 1,
  tint = null,
  outMs,
}: Options = {}): PressFeedbackHandle {
  const reduceMotion = useReduceMotion();
  const pressed = useSharedValue(0);

  const active = feedback !== "none";
  const scaleDelta = active && feedback === "scale" && !reduceMotion ? 1 - (scale ?? PRESS_SCALE.button) : 0;
  const dimDelta = active ? 1 - (dim ?? (feedback === "dim" ? PRESS_DIM.link : PRESS_DIM.surface)) : 0;
  const tintFrom = feedback === "scale" && tint ? tint.from : null;
  const tintTo = feedback === "scale" && tint ? tint.to : null;

  const animatedStyle = useAnimatedStyle(() => {
    const progress = pressed.value;
    const style: ViewStyle = {
      opacity: restOpacity * (1 - dimDelta * progress),
      transform: [{ scale: 1 - scaleDelta * progress }],
    };
    if (tintFrom !== null && tintTo !== null) {
      style.backgroundColor = interpolateColor(progress, [0, 1], [tintFrom, tintTo]);
    }
    return style;
  });

  const inMs = reduceMotion ? 0 : PRESS_IN_MS;
  const releaseMs = reduceMotion ? 0 : (outMs ?? PRESS_OUT_MS);
  const onPressIn = useCallback(() => {
    if (!active) return;
    pressed.value = withTiming(1, { duration: inMs, easing: PRESS_EASE });
  }, [active, inMs, pressed]);
  const onPressOut = useCallback(() => {
    if (!active) return;
    pressed.value = withTiming(0, { duration: releaseMs, easing: PRESS_EASE });
  }, [active, releaseMs, pressed]);

  return useMemo(() => ({ pressed, animatedStyle, onPressIn, onPressOut }), [pressed, animatedStyle, onPressIn, onPressOut]);
}

type TintColors = { accent: string; ink: string; panel: string; panel2: string };

const HEX = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;

/**
 * The fill a surface eases to while pressed, or null when it has none to ease
 * (a transparent or translucent surface just scales and dims). An accent fill
 * moves `TINT_MIX` toward the ink colour, so a label drawn in the panel colour
 * only gains contrast; anything else moves toward `panel2` (or toward ink when
 * it already sits on `panel2`, where that tint would be invisible). A card that
 * sets no fill of its own passes `assumePanel`, since it is drawn on the panel.
 */
export function pressTint(
  style: StyleProp<ViewStyle>,
  colors: TintColors,
  { accent = false, assumePanel = false }: { accent?: boolean; assumePanel?: boolean } = {}
): PressTint | null {
  const flat = StyleSheet.flatten(style)?.backgroundColor;
  const base = flat === undefined && assumePanel ? colors.panel : flat;
  if (accent) {
    const from = typeof base === "string" && HEX.test(base) ? base : colors.accent;
    return { from, to: mixColors(colors.accent, colors.ink, TINT_MIX) };
  }
  if (typeof base !== "string" || !HEX.test(base)) return null;
  if (base.toLowerCase() === colors.accent.toLowerCase()) return { from: base, to: mixColors(base, colors.ink, TINT_MIX) };
  if (base.toLowerCase() === colors.panel2.toLowerCase()) return { from: base, to: mixColors(base, colors.ink, TINT_MIX / 2) };
  return { from: base, to: colors.panel2 };
}
