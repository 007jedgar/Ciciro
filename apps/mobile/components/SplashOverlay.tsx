import { useEffect, useRef, useState } from "react";
import { StyleSheet, useWindowDimensions } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";
import { hexToRgb255, mixColors } from "../lib/color";
import { useSession } from "../lib/session";
import { useOptionalAppTheme } from "../lib/settings";
import {
  BAR_HEIGHT,
  CARET_WIDTH,
  HANDOFF,
  MARK,
  SPLASH_BG,
  finishHandoff,
  handoffClock,
  useWelcomeTargets,
  type BarTarget,
  type WelcomeTargets,
} from "../lib/splash-handoff";
import { THEME_PALETTES, DEFAULT_THEME } from "../lib/theme";
import { useReduceMotion } from "../lib/use-reduce-motion";
import { easeInOut, easeOut, mix, seg } from "../lib/worklet-math";
import { useTimingOnFirstFrame } from "../lib/use-timing-on-first-frame";

type Rgb = [number, number, number];
const toRgb = hexToRgb255;

type Shared = { clock: SharedValue<number>; flyOn: SharedValue<number>; fade: SharedValue<number> };

/** The ring of the mark: it lets go (grows and fades) as the dots set off, or just fades. */
function SplashRing({ clock, flyOn, fade, cx, cy }: Shared & { cx: number; cy: number }) {
  const ringMs = HANDOFF.ringMs;
  const style = useAnimatedStyle(() => {
    const c = flyOn.value === 1 ? clock.value : 0;
    const p = easeOut(seg(c, 0, ringMs));
    return { opacity: (1 - p) * (1 - fade.value), transform: [{ scale: mix(1, 1.5, p) }] };
  });
  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          left: cx - MARK.ringOuter / 2,
          top: cy - MARK.ringOuter / 2,
          width: MARK.ringOuter,
          height: MARK.ringOuter,
          borderRadius: MARK.ringOuter / 2,
          borderWidth: MARK.ringBorder,
          borderColor: MARK.ring,
        },
        style,
      ]}
    />
  );
}

/**
 * One dot of the mark. It sets off for its line, stretching from a dot into a
 * bar on the way; later the bars narrow to carets (the first becomes the
 * writing caret, the other two go), once the page behind them has built itself.
 */
function SplashDot({
  index,
  clock,
  flyOn,
  fade,
  cx,
  cy,
  target,
  caretTop,
  caretHeight,
  barRgb,
  caretRgb,
}: Shared & {
  index: number;
  cx: number;
  cy: number;
  target: BarTarget;
  caretTop: number;
  caretHeight: number;
  barRgb: Rgb;
  caretRgb: Rgb;
}) {
  const dot = MARK.dot;
  const startLeft = cx + (index - 1) * MARK.dotGap - dot / 2;
  const startTop = cy - dot / 2;
  const flightStart = HANDOFF.dotStartMs + index * HANDOFF.dotStaggerMs;
  const flightMs = HANDOFF.dotMs;
  const collapseStart = HANDOFF.collapseStartMs + index * HANDOFF.collapseStaggerMs;
  const collapseMs = HANDOFF.collapseMs;
  const barHeight = BAR_HEIGHT;
  const caretWidth = CARET_WIDTH;
  const first = index === 0;
  const vermilion = toRgb(MARK.dotColor);
  const { x: tx, y: ty, width: tw } = target;

  const style = useAnimatedStyle(() => {
    const c = flyOn.value === 1 ? clock.value : 0;
    const p = easeInOut(seg(c, flightStart, flightStart + flightMs));
    const q = easeInOut(seg(c, collapseStart, collapseStart + collapseMs));
    const width = mix(mix(dot, tw, p), caretWidth, q);
    const height = first ? mix(mix(dot, barHeight, p), caretHeight, q) : mix(dot, barHeight, p);
    const top = first ? mix(mix(startTop, ty, p), caretTop, q) : mix(startTop, ty, p);
    const r = mix(mix(vermilion[0], barRgb[0], p), caretRgb[0], q);
    const g = mix(mix(vermilion[1], barRgb[1], p), caretRgb[1], q);
    const b = mix(mix(vermilion[2], barRgb[2], p), caretRgb[2], q);
    return {
      left: mix(startLeft, tx, p),
      top,
      width,
      height,
      borderRadius: Math.min(width, height) / 2,
      backgroundColor: `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`,
      opacity: (first ? 1 : 1 - q) * (1 - fade.value),
    };
  });

  return <Animated.View style={[styles.dot, { width: dot, height: dot }, style]} />;
}

/**
 * The native splash, redrawn in JS over the whole app, then played out.
 *
 * Mounted at the root so it is on screen the moment JS runs; the native splash
 * is hidden only once this has been laid out (so one is always showing, and the
 * mark never jumps). It then waits for the session to be ready, never longer
 * than `HANDOFF.patienceMs`, and plays: the dots into the welcome card's lines
 * for a signed-out author whose card has said where its lines are, otherwise
 * (signed in, Reduce motion, no card to land on) a plain fade.
 */
export function SplashOverlay() {
  const { width, height } = useWindowDimensions();
  const { ready, user } = useSession();
  const themed = useOptionalAppTheme();
  const reduceMotion = useReduceMotion();
  const targets = useWelcomeTargets();
  const palette = themed?.colors ?? THEME_PALETTES[DEFAULT_THEME];
  const [mode, setMode] = useState<"hold" | "fly" | "fade">("hold");
  const [visible, setVisible] = useState(true);

  const flyOn = useSharedValue(0);
  const fade = useSharedValue(0);
  const beginFly = useTimingOnFirstFrame(handoffClock, {
    to: HANDOFF.totalMs,
    duration: HANDOFF.totalMs,
    easing: Easing.linear,
    autoStart: false,
  });
  const beginFade = useTimingOnFirstFrame(fade, {
    duration: HANDOFF.fadeMs,
    easing: Easing.out(Easing.quad),
    autoStart: false,
  });

  // The native splash goes only once this overlay is laid out and a frame of it has been drawn.
  const nativeHidden = useRef(false);
  const hideNative = () => {
    if (nativeHidden.current) return;
    nativeHidden.current = true;
    requestAnimationFrame(() => requestAnimationFrame(() => void SplashScreen.hideAsync().catch(() => {})));
  };
  useEffect(() => {
    const timer = setTimeout(hideNative, 1200); // layout never reported: do not strand the native splash
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (mode !== "hold") return;
    if (!ready) {
      const timer = setTimeout(() => setMode("fade"), HANDOFF.patienceMs);
      return () => clearTimeout(timer);
    }
    if (user || reduceMotion) {
      setMode("fade");
      return;
    }
    if (targets) {
      setMode("fly");
      return;
    }
    const timer = setTimeout(() => setMode("fade"), HANDOFF.targetsWaitMs);
    return () => clearTimeout(timer);
  }, [mode, ready, user, reduceMotion, targets]);

  useEffect(() => {
    if (mode === "fly") {
      flyOn.value = 1;
      handoffClock.value = 0;
      beginFly();
    } else if (mode === "fade") {
      // The page behind is built at once; the splash just fades off it.
      flyOn.value = 0;
      handoffClock.value = HANDOFF.totalMs;
      beginFade();
    }
  }, [mode, flyOn, beginFly, beginFade]);

  const finish = () => {
    finishHandoff();
    setVisible(false);
  };
  const totalMs = HANDOFF.totalMs;
  useAnimatedReaction(
    () => (flyOn.value === 1 ? handoffClock.value >= totalMs : fade.value >= 1),
    (done, was) => {
      if (done && !was) runOnJS(finish)();
    }
  );

  const bgFadeStart = HANDOFF.bgFadeStartMs;
  const bgFadeMs = HANDOFF.bgFadeMs;
  const bgStyle = useAnimatedStyle(() => {
    const c = flyOn.value === 1 ? handoffClock.value : 0;
    return { opacity: (1 - seg(c, bgFadeStart, bgFadeStart + bgFadeMs)) * (1 - fade.value) };
  });

  if (!visible) return null;

  const cx = width / 2;
  const cy = height / 2;
  // Until the card says where its lines are, the dots have nowhere to go: they stay where they start.
  const landing: WelcomeTargets =
    targets ?? {
      bars: [0, 1, 2].map((i) => ({ x: cx + (i - 1) * MARK.dotGap - MARK.dot / 2, y: cy - BAR_HEIGHT / 2, width: MARK.dot })) as WelcomeTargets["bars"],
      caretTop: cy - MARK.dot / 2,
      caretHeight: MARK.dot,
    };
  const barRgb = toRgb(mixColors(palette.panel, palette.ink, 0.28));
  const caretRgb = toRgb(palette.accent);
  const shared = { clock: handoffClock, flyOn, fade };

  return (
    <Animated.View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={hideNative}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: SPLASH_BG }, bgStyle]} />
      <SplashRing {...shared} cx={cx} cy={cy} />
      {landing.bars.map((bar, i) => (
        <SplashDot
          key={i}
          index={i}
          {...shared}
          cx={cx}
          cy={cy}
          target={bar}
          caretTop={landing.caretTop}
          caretHeight={landing.caretHeight}
          barRgb={barRgb}
          caretRgb={caretRgb}
        />
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  dot: { position: "absolute", backgroundColor: MARK.dotColor },
});
