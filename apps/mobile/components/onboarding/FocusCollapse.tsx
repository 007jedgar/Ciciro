import type { ReactNode } from "react";
import { StyleSheet, type LayoutChangeEvent } from "react-native";
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
  natural: naturalOut,
  children,
}: {
  progress: SharedValue<number>;
  /** -1 slides it up, 1 slides it down. */
  direction: -1 | 1;
  /** True once it is gone: hides it from touch and screen readers. */
  hidden: boolean;
  /** Where the measured natural height is kept, for someone else to read it (the focus demo's exit link). */
  natural?: SharedValue<number>;
  children: ReactNode;
}) {
  const ownNatural = useSharedValue(0);
  const natural = naturalOut ?? ownNatural;
  // Re-measured whenever it changes (a larger text size, a rotated phone), but only
  // while it is fully open: as the outer height closes, the layout squeezes the
  // block with it, and that squeezed height is not its natural one.
  const onLayout = (event: LayoutChangeEvent) => {
    if (progress.value === 0) natural.value = event.nativeEvent.layout.height;
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
      <Animated.View onLayout={onLayout} style={[styles.inner, inner]}>
        {children}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Never squeezed by the shrinking outer: it slides and fades, it does not reflow.
  inner: { flexShrink: 0 },
});
