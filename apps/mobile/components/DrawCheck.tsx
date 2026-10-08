import { useEffect } from "react";
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { useReduceMotion } from "../lib/use-reduce-motion";

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** Length of the tick's path (two straight strokes), which the dash draws along. */
const CHECK_LENGTH = 20;
export const CHECK_DRAW_MS = 320;

/**
 * Drives a `DrawCheck`: 0 (nothing drawn) to 1 (complete). With `play` already
 * true on mount it starts complete, so a goal that was met earlier shows its
 * tick without replaying; when `play` flips to true it draws over
 * `CHECK_DRAW_MS` after `delayMs`. Reduce motion jumps to complete.
 */
export function useDrawProgress(play: boolean, delayMs = 0): SharedValue<number> {
  const reduceMotion = useReduceMotion();
  const progress = useSharedValue(play ? 1 : 0);
  useEffect(() => {
    if (!play) {
      progress.value = 0;
      return;
    }
    if (reduceMotion) {
      progress.value = 1;
      return;
    }
    progress.value = withDelay(delayMs, withTiming(1, { duration: CHECK_DRAW_MS, easing: Easing.out(Easing.cubic) }));
    // Only a change in `play` should draw it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play]);
  return progress;
}

/**
 * A tick that draws itself in: an animation with a start and a finish, used to
 * close out a completed thing (goal met, sprint over, chapter final).
 */
export function DrawCheck({
  progress,
  color,
  size = 16,
  strokeWidth = 2.4,
}: {
  progress: SharedValue<number>;
  color: string;
  size?: number;
  strokeWidth?: number;
}) {
  const length = CHECK_LENGTH;
  const animatedProps = useAnimatedProps(() => ({ strokeDashoffset: length * (1 - progress.value) }));
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no">
      <AnimatedPath
        d="M5 12.5 L9.5 17 L19 7.5"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        strokeDasharray={[CHECK_LENGTH, CHECK_LENGTH]}
        animatedProps={animatedProps}
      />
    </Svg>
  );
}
