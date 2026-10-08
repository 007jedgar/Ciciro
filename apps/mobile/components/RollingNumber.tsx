import { useEffect, useRef, useState } from "react";
import { StyleSheet, View, type TextStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useReduceMotion } from "../lib/use-reduce-motion";

const TICK_MS = 220;

/**
 * A number (or a short formatted figure such as "2,310 words") that ticks like a slot counter: when it changes the old digits slide
 * up and out while the new ones rise in from below. The current value sits in
 * normal flow so the box is always the right width; the leaving one is laid
 * over it. With reduce motion it just changes.
 */
export function RollingNumber({ value, style }: { value: number | string; style?: TextStyle }) {
  const reduceMotion = useReduceMotion();
  const [shown, setShown] = useState(value);
  const [leaving, setLeaving] = useState<number | string | null>(null);
  const first = useRef(true);
  const progress = useSharedValue(1);
  const lineHeight = (style?.lineHeight ?? style?.fontSize ?? 16) as number;

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (value === shown) return;
    if (reduceMotion) {
      setShown(value);
      return;
    }
    setLeaving(shown);
    setShown(value);
    progress.value = 0;
    progress.value = withTiming(1, { duration: TICK_MS, easing: Easing.out(Easing.cubic) });
    const timer = setTimeout(() => setLeaving(null), TICK_MS);
    return () => clearTimeout(timer);
    // `shown` is what we are animating away from; only a new value should retrigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const incoming = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * lineHeight }],
  }));
  const outgoing = useAnimatedStyle(() => ({
    opacity: 1 - progress.value,
    transform: [{ translateY: -progress.value * lineHeight }],
  }));

  return (
    <View style={[styles.box, { height: lineHeight }]} testID="rolling-number">
      <Animated.Text style={[style, incoming]}>{shown}</Animated.Text>
      {leaving !== null ? (
        <Animated.Text style={[style, styles.leaving, outgoing]} accessibilityElementsHidden>
          {leaving}
        </Animated.Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: "hidden", justifyContent: "center" },
  leaving: { position: "absolute", left: 0, right: 0 },
});
