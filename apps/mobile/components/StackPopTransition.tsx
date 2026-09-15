import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { StyleSheet, useWindowDimensions } from "react-native";
import { useNavigation } from "expo-router";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useOptionalAppTheme } from "../lib/settings";
import { THEME_PALETTES } from "../lib/theme";
import {
  shouldInterceptStackRemove,
  STACK_POP_FADE_MS,
  STACK_POP_MS,
  stackPopTransform,
} from "../lib/stack-pop";

const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);

/**
 * Outgoing stack screens round off, shrink, and tuck away to the right on back.
 * Wired once via Stack `screenLayout` so every native-stack route inherits it.
 *
 * The screen being returned to has to be underneath for any of this to read, so
 * a route that pops this way is presented over the stack rather than replacing
 * it — see `presentation` in the root layout.
 */
export function StackPopTransition({ children }: { children: ReactNode }) {
  const navigation = useNavigation();
  const { width } = useWindowDimensions();
  const theme = useOptionalAppTheme();
  const colors = theme?.colors ?? THEME_PALETTES.parchment;
  const osReduce = useReducedMotion();
  const reduceMotion = Boolean(theme?.settings.reduceMotion || osReduce);
  const progress = useSharedValue(0);
  const allowing = useRef(false);

  const dispatchAction = useCallback(
    (action: { type: string; payload?: object; source?: string; target?: string }) => {
      if (allowing.current) return;
      allowing.current = true;
      navigation.dispatch(action);
    },
    [navigation]
  );

  useEffect(() => {
    const unsub = navigation.addListener("beforeRemove", (event) => {
      if (allowing.current) return;
      if (!shouldInterceptStackRemove(event.data.action.type)) return;
      event.preventDefault();
      const action = event.data.action;
      const duration = reduceMotion ? STACK_POP_FADE_MS : STACK_POP_MS;
      progress.value = withTiming(1, { duration, easing: reduceMotion ? Easing.linear : EASE_OUT }, (finished) => {
        if (finished) runOnJS(dispatchAction)(action);
      });
    });
    return unsub;
  }, [dispatchAction, navigation, progress, reduceMotion]);

  const style = useAnimatedStyle(() => {
    if (reduceMotion) {
      // A straight fade, with none of the hold the full pop uses — there is no
      // collapse to watch, so drawing it out would only be a delay.
      return {
        opacity: 1 - Math.max(0, Math.min(1, progress.value)),
        borderRadius: 0,
        transform: [],
      };
    }
    const next = stackPopTransform(progress.value, width);
    return {
      opacity: next.opacity,
      borderRadius: next.radius,
      transform: [
        { scale: next.scale },
        { translateX: next.translateX },
        { translateY: next.translateY },
      ],
    };
  });

  // The page colour is painted here rather than left to the stack's own content
  // background, which sits a level up: that one would stay full-screen behind
  // the collapse and hide whatever the pop is revealing.
  return (
    <Animated.View style={[styles.fill, { backgroundColor: colors.bg }, style]}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Clipped, so the corners the screen grows on the way out actually cut the
  // content rather than rounding an edge nothing is drawn on.
  fill: { flex: 1, overflow: "hidden" },
});
