import type { ReactNode } from "react";
import type { LayoutChangeEvent } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, type SharedValue } from "react-native-reanimated";

/**
 * A block that leaves with focus mode: it fades and slides away (up for what is
 * above the page, down for what is below it) while its height closes behind it,
 * so the page glides into the space it frees, and back out the same way when
 * `progress` returns to 0. Its natural height is measured once, so the block
 * stays mounted either way and nothing below it remounts.
 */
export function FocusCollapse({
  progress,
  direction,
  hidden,
  children,
}: {
  progress: SharedValue<number>;
  /** -1 slides it up, 1 slides it down. */
  direction: -1 | 1;
  /** True once it is gone: hides it from touch and screen readers. */
  hidden: boolean;
  children: ReactNode;
}) {
  const natural = useSharedValue(0);
  // Re-measured whenever it changes (a larger text size, a rotated phone).
  const onLayout = (event: LayoutChangeEvent) => {
    natural.value = event.nativeEvent.layout.height;
  };

  const outer = useAnimatedStyle(() =>
    natural.value > 0 ? { height: natural.value * (1 - progress.value), overflow: "hidden" } : {}
  );
  const inner = useAnimatedStyle(() => ({
    opacity: 1 - progress.value,
    transform: [{ translateY: direction * natural.value * progress.value }],
  }));

  return (
    <Animated.View
      pointerEvents={hidden ? "none" : "auto"}
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? "no-hide-descendants" : "auto"}
      style={outer}
    >
      <Animated.View onLayout={onLayout} style={inner}>
        {children}
      </Animated.View>
    </Animated.View>
  );
}
