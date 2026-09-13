import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { StyleSheet } from "react-native";
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
import {
  shouldInterceptStackRemove,
  STACK_POP_FADE_MS,
  STACK_POP_MS,
  stackPopTransform,
} from "../lib/stack-pop";

const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);

/**
 * Outgoing stack screens shrink, fade, and drift down-right on back.
 * Wired once via Stack `screenLayout` so every native-stack route inherits it.
 */
export function StackPopTransition({ children }: { children: ReactNode }) {
  const navigation = useNavigation();
  const theme = useOptionalAppTheme();
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
    const next = stackPopTransform(reduceMotion ? Math.min(progress.value, 1) : progress.value);
    if (reduceMotion) {
      return { opacity: next.opacity, transform: [] };
    }
    return {
      opacity: next.opacity,
      transform: [
        { scale: next.scale },
        { translateX: next.translateX },
        { translateY: next.translateY },
      ],
    };
  });

  return <Animated.View style={[styles.fill, style]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
