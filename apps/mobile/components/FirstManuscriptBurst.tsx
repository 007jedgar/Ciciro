import { useEffect, useState } from "react";
import { StyleSheet } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming } from "react-native-reanimated";
import { EASE_OUT } from "../lib/motion";
import { BrandDots } from "./BrandDots";

/** How long the mark stays up between fading in and out, and the gap between its two hops. */
const HOLD_MS = 1000;
const HOP_GAP_MS = 480;

/**
 * The one-time flourish for an account's first manuscript: the brand's three
 * dots rise into view over the new chapters screen, hop twice, and fade away.
 * It always finishes (a complete beat, not a loop) and never takes a touch.
 * Skipped under reduce motion by the caller, since it is only decoration.
 */
export function FirstManuscriptBurst({ top, color, delayMs }: { top: number; color: string; delayMs: number }) {
  const opacity = useSharedValue(0);
  const [signal, setSignal] = useState(0);

  useEffect(() => {
    opacity.value = withDelay(
      delayMs,
      withSequence(
        withTiming(1, { duration: 160, easing: EASE_OUT }),
        withDelay(HOLD_MS, withTiming(0, { duration: 520, easing: EASE_OUT }))
      )
    );
    const first = setTimeout(() => setSignal(1), delayMs + 120);
    const second = setTimeout(() => setSignal(2), delayMs + 120 + HOP_GAP_MS);
    return () => {
      clearTimeout(first);
      clearTimeout(second);
    };
  }, [delayMs, opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View pointerEvents="none" style={[styles.wrap, { top }, style]} testID="first-manuscript-burst">
      <BrandDots size={72} color={color} interactive={false} playSignal={signal} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, alignItems: "center", zIndex: 10 },
});
