import { useCallback } from "react";
import type { GestureResponderEvent } from "react-native";
import { useWindowDimensions } from "react-native";
import { startThemeWash } from "./theme-wash";
import { useReduceMotion } from "./use-reduce-motion";

/**
 * Changes the theme with the wash (the caller's pressable already taps): a circle
 * opens from the finger and shows the screen in its new theme. With Reduce
 * motion on the swap is immediate. Returns false when a wash is already playing.
 */
export function useThemeChange(): (apply: () => void, event?: GestureResponderEvent) => boolean {
  const reduceMotion = useReduceMotion();
  const { width, height } = useWindowDimensions();
  return useCallback(
    (apply, event) => {
      if (reduceMotion) {
        apply();
        return true;
      }
      const x = event?.nativeEvent?.pageX ?? width / 2;
      const y = event?.nativeEvent?.pageY ?? height / 2;
      return startThemeWash({ x, y, apply });
    },
    [reduceMotion, width, height]
  );
}
