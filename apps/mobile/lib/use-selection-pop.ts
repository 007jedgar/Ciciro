import { useEffect, useRef } from "react";
import { POP_PEAK, POP_SPRING, POP_UP_MS, SELECT_FADE_MS } from "./motion";
import {
  Easing,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

/**
 * Drives the crossfade + scale pop a single-select pill or row plays when its
 * selected state flips, replacing the hard background/border cut. `progress`
 * goes 0 (unselected) to 1 (selected) for `interpolateColor`/`interpolate`
 * calls in the caller's `useAnimatedStyle`; `scale` pops to 1.06 and springs
 * back to 1 only on the transition into selected, and only without reduce
 * motion (the color crossfade itself still runs, since it isn't motion).
 */
export function useSelectionPop(
  active: boolean,
  reduceMotion: boolean
): { progress: SharedValue<number>; scale: SharedValue<number> } {
  const progress = useSharedValue(active ? 1 : 0);
  const scale = useSharedValue(1);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    progress.value = withTiming(active ? 1 : 0, {
      duration: SELECT_FADE_MS,
      easing: Easing.out(Easing.cubic),
    });
    if (active && !reduceMotion) {
      scale.value = withSequence(
        withTiming(POP_PEAK, { duration: POP_UP_MS, easing: Easing.out(Easing.cubic) }),
        withSpring(1, POP_SPRING)
      );
    }
    // Only a change in `active` should retrigger the crossfade/pop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return { progress, scale };
}
