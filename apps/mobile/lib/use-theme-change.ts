import { useCallback } from "react";
import type { GestureResponderEvent } from "react-native";
import { useWindowDimensions } from "react-native";
import { startThemeWash } from "./theme-wash";
import { THEME_PALETTES, type ThemeId } from "./theme";
import { useReduceMotion } from "./use-reduce-motion";

/**
 * Changes the theme with the wash (the caller's pressable already taps): the new paper spreads from the finger and the
 * swap happens under it. With Reduce motion on, or no touch point to spread
 * from, the swap is immediate. Returns false when a wash is already playing.
 */
export function useThemeChange(): (theme: ThemeId, apply: () => void, event?: GestureResponderEvent) => boolean {
  const reduceMotion = useReduceMotion();
  const { width, height } = useWindowDimensions();
  return useCallback(
    (theme, apply, event) => {
      if (reduceMotion) {
        apply();
        return true;
      }
      const x = event?.nativeEvent?.pageX ?? width / 2;
      const y = event?.nativeEvent?.pageY ?? height / 2;
      return startThemeWash({ x, y, color: THEME_PALETTES[theme].bg, apply });
    },
    [reduceMotion, width, height]
  );
}
