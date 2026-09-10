import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type TextStyle,
} from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Polyline } from "react-native-svg";
import * as Haptics from "expo-haptics";
import { useAppTheme } from "../lib/settings";
import { fonts } from "../lib/theme";
import { LEDES, PASSAGES } from "../lib/living-page/scenes";

const FONT_SIZE = 24;
const LINE_H = 44;
const MS_PER_CHAR = 42;
const LINE_PAUSE = 480;
const LEAD_IN = 420;
// after the last letter the caret holds, then dissolves; the clock runs long
// enough for that tail to finish
const CARET_TAIL = 700;
const PASSAGE_FADE_DELAY = 500;
const PASSAGE_FADE = 1900;
const LEDE_MS_PER_CHAR = 38;
const LEDE_LEAD = 250;
const LEDE_HOLD = 2600;
const LEDE_FADE = 420;
const MAX_BLUR = 85;

// ---- worklet math helpers ---------------------------------------------------
const seg = (p: number, a: number, b: number) => {
  "worklet";
  return Math.min(1, Math.max(0, (p - a) / (b - a)));
};
const clamp01 = (v: number) => {
  "worklet";
  return Math.min(1, Math.max(0, v));
};

type LineWindow = { start: number; end: number };

/** Per-line typing windows on the passage's master clock, in ms. */
function passageTimeline(lines: string[]) {
  let t = LEAD_IN;
  const windows: LineWindow[] = lines.map((line) => {
    const start = t;
    const end = start + line.length * MS_PER_CHAR;
    t = end + LINE_PAUSE;
    return { start, end };
  });
  const typedEnd = windows.length ? windows[windows.length - 1].end : LEAD_IN;
  return { windows, typedEnd };
}

// ---- one line writing itself in --------------------------------------------
function TypedLine({
  text,
  win,
  clock,
  color,
  caretColor,
  textStyle,
  height,
  align = "left",
}: {
  text: string;
  win: LineWindow;
  clock: SharedValue<number>;
  color: string;
  caretColor: string;
  textStyle: TextStyle;
  height: number;
  align?: "left" | "center";
}) {
  const [w, setW] = useState(0);

  const reveal = useDerivedValue(() => seg(clock.value, win.start, win.end));
  const clipStyle = useAnimatedStyle(() => ({ width: reveal.value * w }));
  const caretStyle = useAnimatedStyle(() => {
    const appear = seg(clock.value, win.start - 150, win.start);
    const dissolve = seg(clock.value, win.end + 250, win.end + CARET_TAIL);
    return {
      left: reveal.value * w + 2,
      opacity: 0.9 * appear * (1 - dissolve),
    };
  });

  return (
    <View
      style={{
        height,
        alignSelf: align === "center" ? "center" : "flex-start",
      }}
    >
      {/* invisible copy fixes the line's intrinsic width for the clip */}
      <Text
        onLayout={(e) => setW(e.nativeEvent.layout.width)}
        style={[textStyle, { color, opacity: 0 }]}
        numberOfLines={1}
      >
        {text}
      </Text>
      <Animated.View style={[styles.lineClip, { height }, clipStyle]}>
        <Text
          style={[textStyle, { color, width: w || undefined }]}
          numberOfLines={1}
        >
          {text}
        </Text>
      </Animated.View>
      <Animated.View
        style={[
          styles.caret,
          {
            top: height * 0.18,
            height: height * 0.64,
            backgroundColor: caretColor,
          },
          caretStyle,
        ]}
      />
    </View>
  );
}

// ---- a passage writing itself in, then dissolving ---------------------------
function PassageBlock({
  lines,
  top,
  fading,
  onTyped,
  onGone,
  inkColor,
  caretColor,
  reduceMotion,
}: {
  lines: string[];
  top: number;
  fading: boolean;
  onTyped: () => void;
  onGone: () => void;
  inkColor: string;
  caretColor: string;
  reduceMotion: boolean;
}) {
  const timeline = useMemo(() => passageTimeline(lines), [lines]);
  const clock = useSharedValue(0);
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (reduceMotion) {
      clock.value = timeline.typedEnd + CARET_TAIL; // finished, caret gone
      return;
    }
    const target = timeline.typedEnd + CARET_TAIL;
    clock.value = withTiming(
      target,
      { duration: target, easing: Easing.linear },
      (finished) => {
        if (finished) runOnJS(onTyped)();
      }
    );
    return () => cancelAnimation(clock);
    // typing runs once for this block's lifetime
  }, []);

  useEffect(() => {
    if (!fading) return;
    opacity.value = withDelay(
      PASSAGE_FADE_DELAY,
      withTiming(0, { duration: PASSAGE_FADE }, (finished) => {
        if (finished) runOnJS(onGone)();
      })
    );
    return () => cancelAnimation(opacity);
  }, [fading]);

  const fadeStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View style={[styles.passage, { top }, fadeStyle]}>
      {lines.map((text, i) => (
        <TypedLine
          key={i}
          text={text}
          win={timeline.windows[i]}
          clock={clock}
          color={inkColor}
          caretColor={caretColor}
          textStyle={styles.line}
          height={LINE_H}
        />
      ))}
    </Animated.View>
  );
}

// ---- frosted glass whose density follows the gesture ------------------------
const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);

function Frost({
  lift,
  dark,
  washColor,
}: {
  lift: SharedValue<number>;
  dark: boolean;
  washColor: string;
}) {
  const blurProps = useAnimatedProps(() => ({
    intensity: lift.value * MAX_BLUR,
  }));
  const washStyle = useAnimatedStyle(() => ({ opacity: lift.value * 0.35 }));
  // Android can't animate blur intensity smoothly; fade a fixed blur instead.
  const fadeStyle = useAnimatedStyle(() => ({ opacity: lift.value }));

  if (Platform.OS === "android") {
    return (
      <Animated.View style={[StyleSheet.absoluteFill, fadeStyle]} pointerEvents="none">
        <BlurView
          style={StyleSheet.absoluteFill}
          intensity={MAX_BLUR}
          tint={dark ? "dark" : "light"}
          experimentalBlurMethod="dimezisBlurView"
        />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: washColor, opacity: 0.35 }]} />
      </Animated.View>
    );
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <AnimatedBlurView
        style={StyleSheet.absoluteFill}
        tint={dark ? "dark" : "light"}
        animatedProps={blurProps}
      />
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: washColor }, washStyle]}
      />
    </View>
  );
}

// ---- the invitation, typed onto the glass -----------------------------------
function TypedLede({
  color,
  caretColor,
  active,
  reduceMotion,
}: {
  color: string;
  caretColor: string;
  active: boolean;
  reduceMotion: boolean;
}) {
  const [index, setIndex] = useState(0);
  const clock = useSharedValue(0);

  const text = LEDES[index];
  const win = useMemo(
    () => ({ start: LEDE_LEAD, end: LEDE_LEAD + text.length * LEDE_MS_PER_CHAR }),
    [text]
  );
  const total = win.end + LEDE_HOLD + LEDE_FADE;

  useEffect(() => {
    if (!active) {
      clock.value = 0;
      return;
    }
    if (reduceMotion) {
      clock.value = win.end + CARET_TAIL; // typed, caret gone, holding
      return;
    }
    clock.value = 0;
    clock.value = withTiming(
      total,
      { duration: total, easing: Easing.linear },
      (finished) => {
        if (finished) {
          runOnJS(setIndex)((index + 1) % LEDES.length);
        }
      }
    );
    return () => cancelAnimation(clock);
  }, [index, active, reduceMotion]);

  const fadeStyle = useAnimatedStyle(() => ({
    opacity: 1 - seg(clock.value, win.end + LEDE_HOLD, total),
  }));

  return (
    <View style={styles.ledeBox}>
      <Animated.View key={index} style={fadeStyle}>
        <TypedLine
          text={text}
          win={win}
          clock={clock}
          color={color}
          caretColor={caretColor}
          textStyle={styles.authLede}
          height={30}
          align="center"
        />
      </Animated.View>
    </View>
  );
}

// ---- the living page ---------------------------------------------------------
type BlockInstance = {
  key: number;
  passageIndex: number;
  slot: 0 | 1;
  fading: boolean;
};

export function LivingPage({
  onCreate,
  onSignIn,
}: {
  onCreate: () => void;
  onSignIn: () => void;
}) {
  const { height: H } = useWindowDimensions();
  const { colors, dark } = useAppTheme();
  const reduceMotion = useReducedMotion();

  // --- the writing: while one passage fades, the next is already arriving ----
  const [blocks, setBlocks] = useState<BlockInstance[]>([
    { key: 0, passageIndex: 0, slot: 0, fading: false },
  ]);
  const nextKey = useRef(1);
  const nextPassage = useRef(1);
  const slotTops = [H * 0.24, H * 0.5];

  const handleTyped = useCallback((key: number) => {
    setBlocks((current) => {
      const done = current.find((b) => b.key === key);
      if (!done || done.fading) return current;
      const spawned: BlockInstance = {
        key: nextKey.current++,
        passageIndex: nextPassage.current++ % PASSAGES.length,
        slot: done.slot === 0 ? 1 : 0,
        fading: false,
      };
      return [
        ...current.map((b) => (b.key === key ? { ...b, fading: true } : b)),
        spawned,
      ];
    });
  }, []);

  const handleGone = useCallback((key: number) => {
    setBlocks((current) => current.filter((b) => b.key !== key));
  }, []);

  // --- swipe up: the page frosts over and the invitation surfaces ------------
  const lift = useSharedValue(0);
  const dragFrom = useSharedValue(0);
  const [peeled, setPeeled] = useState(false);

  const settle = (open: boolean) => {
    if (open) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setPeeled(open);
  };

  const pan = Gesture.Pan()
    .activeOffsetY([-14, 14])
    .onStart(() => {
      dragFrom.value = lift.value;
    })
    .onUpdate((e) => {
      lift.value = clamp01(dragFrom.value - e.translationY / (H * 0.45));
    })
    .onEnd((e) => {
      const open = e.velocityY < -600 || (lift.value > 0.45 && e.velocityY < 600);
      if (open) {
        lift.value = withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) });
      } else {
        lift.value = withSpring(0, { damping: 20, stiffness: 180 });
      }
      runOnJS(settle)(open);
    });

  const beginByTap = () => {
    Haptics.selectionAsync().catch(() => {});
    lift.value = withTiming(1, { duration: reduceMotion ? 220 : 560, easing: Easing.out(Easing.cubic) });
    setPeeled(true);
  };

  const authStyle = useAnimatedStyle(() => ({
    opacity: seg(lift.value, 0.55, 1),
  }));
  const hintStyle = useAnimatedStyle(() => ({
    opacity: 1 - Math.min(1, lift.value * 3),
  }));

  // --- the primary button's slow glow ----------------------------------------
  const glow = useSharedValue(0);
  useEffect(() => {
    if (!peeled || reduceMotion) {
      cancelAnimation(glow);
      glow.value = reduceMotion && peeled ? 0.5 : 0;
      return;
    }
    glow.value = withRepeat(
      withTiming(1, { duration: 1900, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    );
    return () => cancelAnimation(glow);
  }, [peeled, reduceMotion, glow]);

  const glowStyle = useAnimatedStyle(() => ({
    shadowOpacity: 0.25 + glow.value * 0.35,
    shadowRadius: 10 + glow.value * 10,
  }));

  return (
    <GestureDetector gesture={pan}>
      <View style={[styles.root, { backgroundColor: colors.bg }]}>
        {/* paper: a whisper of warmth from the top of the page */}
        <LinearGradient
          colors={[colors.panel, colors.bg]}
          style={StyleSheet.absoluteFill}
        />

        {/* the writing fills the screen; it never stops, even under the glass */}
        <View
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        >
          <View style={[styles.brandRow, { top: H * 0.1 }]}>
            <Text style={[styles.wordmark, { color: colors.ink }]}>Ciciro</Text>
          </View>
          {blocks.map((block) => (
            <PassageBlock
              key={block.key}
              lines={PASSAGES[block.passageIndex]}
              top={slotTops[block.slot]}
              fading={block.fading}
              onTyped={() => handleTyped(block.key)}
              onGone={() => handleGone(block.key)}
              inkColor={colors.ink}
              caretColor={colors.accent}
              reduceMotion={reduceMotion}
            />
          ))}
        </View>

        {/* the invitation to begin */}
        <Animated.View
          style={[styles.hint, { bottom: H * 0.08 }, hintStyle]}
          pointerEvents={peeled ? "none" : "auto"}
        >
          <Pressable
            onPress={beginByTap}
            accessibilityRole="button"
            accessibilityLabel="Begin - create your account or sign in"
            hitSlop={20}
            style={styles.hintPress}
          >
            <Svg width={30} height={16} viewBox="0 0 30 16">
              <Polyline
                points="3,13 15,3 27,13"
                fill="none"
                stroke={colors.accent}
                strokeWidth={2.4}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
            <Text style={[styles.hintText, { color: colors.inkSoft }]}>
              Swipe up to begin
            </Text>
          </Pressable>
        </Animated.View>

        {/* glass over the page, thickening with the swipe */}
        <Frost lift={lift} dark={dark} washColor={colors.bg} />

        {/* the auth invitation, sharp on the frosted glass */}
        <Animated.View
          style={[styles.auth, authStyle]}
          pointerEvents={peeled ? "auto" : "none"}
          accessibilityElementsHidden={!peeled}
          importantForAccessibility={peeled ? "auto" : "no-hide-descendants"}
        >
          <Text style={[styles.authMark, { color: colors.ink }]}>Ciciro</Text>
          <TypedLede
            color={colors.inkSoft}
            caretColor={colors.accent}
            active={peeled}
            reduceMotion={reduceMotion}
          />
          <Animated.View
            style={[styles.primaryGlow, { shadowColor: colors.accent }, glowStyle]}
          >
            <Pressable
              onPress={onCreate}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.primary,
                { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Text style={[styles.primaryText, { color: colors.panel }]}>
                Create your account
              </Text>
            </Pressable>
          </Animated.View>
          <Pressable onPress={onSignIn} accessibilityRole="button" style={styles.ghost}>
            <Text style={[styles.ghostText, { color: colors.accent }]}>
              I already have an account
            </Text>
          </Pressable>
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: "hidden" },
  brandRow: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  wordmark: {
    fontFamily: fonts.serif,
    fontSize: 18,
    letterSpacing: 3,
    textTransform: "uppercase",
  },
  passage: { position: "absolute", left: 28, right: 28 },
  line: {
    fontFamily: fonts.serif,
    fontSize: FONT_SIZE,
    fontStyle: "italic",
    lineHeight: LINE_H,
  },
  lineClip: {
    position: "absolute",
    left: 0,
    top: 0,
    overflow: "hidden",
  },
  caret: {
    position: "absolute",
    width: 2,
    borderRadius: 1,
  },
  hint: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  hintPress: { alignItems: "center", paddingVertical: 8 },
  hintText: { fontSize: 13, marginTop: 6, letterSpacing: 0.4 },
  auth: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  authMark: {
    fontFamily: fonts.serif,
    fontSize: 22,
    letterSpacing: 4,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  ledeBox: {
    height: 56,
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 28,
  },
  authLede: {
    fontFamily: fonts.serif,
    fontSize: 17,
    fontStyle: "italic",
    lineHeight: 30,
  },
  primaryGlow: {
    alignSelf: "stretch",
    borderRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 10,
  },
  primary: {
    borderRadius: 10,
    paddingVertical: 15,
    paddingHorizontal: 28,
    alignItems: "center",
  },
  primaryText: { fontSize: 16, fontWeight: "600" },
  ghost: { paddingVertical: 16, alignItems: "center" },
  ghostText: { fontSize: 15 },
});
