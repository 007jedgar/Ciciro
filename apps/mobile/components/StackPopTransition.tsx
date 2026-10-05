import { useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
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
import { useTimingOnFirstFrame } from "../lib/use-timing-on-first-frame";
import { EASE_OUT, EASE_PUSH } from "../lib/motion";
import { createArrivalSignal, StackArrivalContext } from "../lib/stack-arrival";
import {
  ownsStackRemove,
  shouldInterceptStackRemove,
  STACK_POP_FADE_MS,
  STACK_POP_MS,
  STACK_PUSH_MS,
  stackPopTransform,
  stackPushTransform,
  stackSheetPopTransform,
} from "../lib/stack-pop";

// A sheet has a long way to fall; the collapse curve would finish most of it in the first frames.
const EASE_SHEET = EASE_PUSH;

/**
 * Outgoing stack screens round off, shrink, and tuck away to the right on back
 * ("collapse"), or slide straight down ("sheet", see `SHEET_POP_ROUTES`).
 * With `enter`, the screen also slides in from the right (a sheet comes up from
 * the bottom) when it is pushed, fading instead under reduce motion.
 * Wired once via Stack `screenLayout` so every native-stack route inherits it.
 *
 * The screen being returned to has to be underneath for any of this to read, so
 * a route that pops this way is presented over the stack rather than replacing
 * it — see `presentation` in the root layout.
 */
export function StackPopTransition({
  children,
  variant = "collapse",
  enter = false,
}: {
  children: ReactNode;
  variant?: "collapse" | "sheet";
  enter?: boolean;
}) {
  const navigation = useNavigation();
  const { width, height } = useWindowDimensions();
  const theme = useOptionalAppTheme();
  const colors = theme?.colors ?? THEME_PALETTES.parchment;
  const osReduce = useReducedMotion();
  const reduceMotion = Boolean(theme?.settings.reduceMotion || osReduce);
  const progress = useSharedValue(0);
  // 0 just pushed, 1 settled. Starts offscreen so the first frame is already
  // out of the way, not a flash of the finished screen.
  const arrival = useSharedValue(enter ? 0 : 1);
  const allowing = useRef(false);

  // Started once the stack reports the screen on show, not at mount: the view
  // is not in the window until the heavy first render has been mounted and
  // presented, and frames counted before that are played where nobody can see
  // them. The timer is for a route the stack never reports (a first screen).
  const startArrival = useTimingOnFirstFrame(arrival, {
    duration: reduceMotion ? STACK_POP_FADE_MS : STACK_PUSH_MS,
    easing: reduceMotion ? Easing.linear : variant === "sheet" ? EASE_SHEET : EASE_PUSH,
    enabled: enter,
    autoStart: false,
  });
  // Content inside a pushed screen times its own entrance from here; a screen
  // that does not slide in passes on the push it sits inside, if any.
  const outerArrival = useContext(StackArrivalContext);
  const [ownArrival] = useState(() => (enter ? createArrivalSignal() : null));
  const beginArrival = useCallback(() => {
    startArrival();
    ownArrival?.fire();
  }, [startArrival, ownArrival]);

  useEffect(() => {
    if (!enter) return;
    const onScreen = navigation.addListener(
      "transitionEnd" as never,
      ((event: { data?: { closing?: boolean } }) => {
        if (!event.data?.closing) beginArrival();
      }) as never
    );
    const fallback = setTimeout(beginArrival, 600);
    return () => {
      onScreen();
      clearTimeout(fallback);
    };
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      const action = event.data.action;
      if (!shouldInterceptStackRemove(action.type)) return;
      // Screens nested inside the one being removed hear this too, and first.
      // Only the screen whose own navigator is doing the removing plays the
      // collapse — see ownsStackRemove for what goes wrong otherwise.
      if (!ownsStackRemove(action, navigation.getState())) return;
      event.preventDefault();
      const duration = reduceMotion ? STACK_POP_FADE_MS : STACK_POP_MS;
      progress.value = withTiming(1, { duration, easing: reduceMotion ? Easing.linear : variant === "sheet" ? EASE_SHEET : EASE_OUT }, (finished) => {
        if (finished) runOnJS(dispatchAction)(action);
      });
    });
    return unsub;
  }, [dispatchAction, navigation, progress, reduceMotion, variant]);

  const style = useAnimatedStyle(() => {
    if (reduceMotion) {
      // A straight fade both ways, with none of the hold the full pop uses —
      // there is no collapse to watch, so drawing it out would only be a delay.
      return {
        opacity: Math.max(0, Math.min(1, arrival.value)) * (1 - Math.max(0, Math.min(1, progress.value))),
        borderRadius: 0,
        transform: [],
      };
    }
    const push = stackPushTransform(arrival.value, width, height, variant === "sheet");
    if (variant === "sheet") {
      const sheet = stackSheetPopTransform(progress.value, height);
      return {
        opacity: 1,
        borderRadius: sheet.radius,
        transform: [{ translateX: push.translateX }, { translateY: sheet.translateY + push.translateY }],
      };
    }
    const next = stackPopTransform(progress.value, width);
    return {
      opacity: next.opacity,
      borderRadius: next.radius,
      transform: [
        { scale: next.scale },
        { translateX: next.translateX + push.translateX },
        { translateY: next.translateY },
      ],
    };
  });

  // The page colour is painted here rather than left to the stack's own content
  // background, which sits a level up: that one would stay full-screen behind
  // the collapse and hide whatever the pop is revealing.
  return (
    <StackArrivalContext.Provider value={ownArrival ?? outerArrival}>
      <Animated.View style={[styles.fill, { backgroundColor: colors.bg }, style]}>
        {children}
      </Animated.View>
    </StackArrivalContext.Provider>
  );
}

const styles = StyleSheet.create({
  // Clipped, so the corners the screen grows on the way out actually cut the
  // content rather than rounding an edge nothing is drawn on.
  fill: { flex: 1, overflow: "hidden" },
});
