import { Animated, Easing } from "react-native";

/** How long the manuscript tabs take to slide past each other. */
export const TAB_SLIDE_MS = 280;

/**
 * Timing for the slide between manuscript tabs. React Navigation drives this
 * with `Animated` on the native thread, so it neither waits on nor blocks the
 * JS thread while a tab is still mounting its content.
 */
export const TAB_SLIDE_SPEC = {
  animation: "timing",
  config: { duration: TAB_SLIDE_MS, easing: Easing.bezier(0.32, 0.72, 0, 1) },
} as const;

/**
 * Scene style for sliding between manuscript tabs. `current.progress` is 0 for
 * the tab on show, 1 for a tab to its right and -1 for one to its left, and it
 * runs between those as the tabs change. So the incoming tab slides in from
 * whichever side it sits on while the outgoing one leaves the other way, with
 * no need to track which direction the user is going.
 */
export function tabSlideInterpolator(width: number) {
  return ({ current }: { current: { progress: Animated.AnimatedInterpolation<number> | Animated.Value } }) => ({
    sceneStyle: {
      transform: [
        {
          translateX: current.progress.interpolate({
            inputRange: [-1, 0, 1],
            outputRange: [-width, 0, width],
          }),
        },
      ],
    },
  });
}
