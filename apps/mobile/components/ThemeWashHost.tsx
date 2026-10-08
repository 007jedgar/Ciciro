import { useEffect, useSyncExternalStore } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { EASE_OUT } from "../lib/motion";
import {
  applyThemeWash,
  finishThemeWash,
  getThemeWash,
  subscribeThemeWash,
  WASH_FADE_MS,
  WASH_SPREAD_MS,
  type ThemeWash,
} from "../lib/theme-wash";

function WashPaper({ wash }: { wash: ThemeWash }) {
  const { width, height } = useWindowDimensions();
  // Big enough that a circle from any tap point reaches the far corner.
  const diameter = Math.ceil(Math.hypot(width, height) * 2);
  const spread = useSharedValue(0);
  const opacity = useSharedValue(1);

  useEffect(() => {
    const done = () => finishThemeWash(wash.id);
    // Back on the JS thread once the paper is solid: swap, then lift the paper.
    const covered = () => {
      applyThemeWash(wash.id);
      opacity.value = withTiming(0, { duration: WASH_FADE_MS, easing: Easing.out(Easing.quad) }, (faded) => {
        if (faded) runOnJS(done)();
      });
    };
    spread.value = withTiming(1, { duration: WASH_SPREAD_MS, easing: EASE_OUT }, (finished) => {
      if (finished) runOnJS(covered)();
    });
    // A wash that never got to finish must not leave the next tap ignored.
    return () => {
      applyThemeWash(wash.id);
      done();
    };
    // One wash, one run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const circle = useAnimatedStyle(() => ({
    transform: [{ scale: Math.max(0.001, spread.value) }],
  }));
  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, fade]} pointerEvents="auto">
      <Animated.View
        style={[
          {
            position: "absolute",
            left: wash.x - diameter / 2,
            top: wash.y - diameter / 2,
            width: diameter,
            height: diameter,
            borderRadius: diameter / 2,
            backgroundColor: wash.color,
          },
          circle,
        ]}
      />
    </Animated.View>
  );
}

/**
 * Paints the active theme wash above everything in its parent. Mount it at the
 * root, and inside any screen presented as a modal (those sit above the root).
 */
export function ThemeWashHost() {
  const wash = useSyncExternalStore(subscribeThemeWash, getThemeWash, getThemeWash);
  if (!wash) return null;
  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 1000 }]} pointerEvents="box-none">
      <WashPaper key={wash.id} wash={wash} />
    </View>
  );
}
