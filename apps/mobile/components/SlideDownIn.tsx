import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { CHAPTERS_SLIDE_DISTANCE, CHAPTERS_SLIDE_MS } from "../lib/chapters-intro";
import { useStackArrival } from "../lib/stack-arrival";
import { useTimingOnFirstFrame } from "../lib/use-timing-on-first-frame";
import { EASE_OUT } from "../lib/motion";
import { useReduceMotion } from "../lib/use-reduce-motion";

/**
 * Slides its content down into place from just above, fading in, once, `delay`
 * ms after the screen it is on starts sliding in. With `enabled` false it renders as a plain view, already in place, so
 * a screen can wrap its list unconditionally and opt in only for the visit that
 * should play it. Reduce motion drops the slide and keeps a short fade.
 */
export function SlideDownIn({
  enabled,
  delay = 0,
  style,
  children,
}: {
  enabled: boolean;
  delay?: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const reduceMotion = useReduceMotion();
  const progress = useSharedValue(enabled ? 0 : 1);

  const begin = useTimingOnFirstFrame(progress, {
    duration: reduceMotion ? 160 : CHAPTERS_SLIDE_MS,
    delay,
    easing: EASE_OUT,
    enabled,
    autoStart: false,
  });
  useStackArrival(begin);

  const distance = reduceMotion ? 0 : CHAPTERS_SLIDE_DISTANCE;
  const animated = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (progress.value - 1) * distance }],
  }));

  return <Animated.View style={[{ flex: 1 }, style, animated]}>{children}</Animated.View>;
}
