import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import {
  Canvas,
  Circle,
  Fill,
  Group,
  Paint,
  Blur,
  Path,
  RadialGradient,
  Skia,
  useClock,
  vec,
} from "@shopify/react-native-skia";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Polyline } from "react-native-svg";
import * as Haptics from "expo-haptics";
import { useAppTheme } from "../lib/settings";
import { fonts } from "../lib/theme";
import { SCENES } from "../lib/living-page/scenes";

const CYCLE_MS = 7200;
const PARTICLE_COUNT = 26;
const WORD_SIZE = 30;
const LINE_H = 44;

// ---- worklet math helpers ---------------------------------------------------
const seg = (p: number, a: number, b: number) => {
  "worklet";
  return Math.min(1, Math.max(0, (p - a) / (b - a)));
};
const ez = (t: number) => {
  "worklet";
  return 1 - Math.pow(1 - t, 3);
};
const lerp = (a: number, b: number, t: number) => {
  "worklet";
  return a + (b - a) * t;
};

// Stable per-index pseudo-random so particle scatter doesn't reshuffle on render.
function rnd(seed: number) {
  const x = Math.sin(seed * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

type Pt = { x: number; y: number };

/** Evenly sample `n` points along an SVG path, in its own 0..100 space. */
function samplePath(svg: string, n: number): Pt[] {
  try {
    const path = Skia.Path.MakeFromSVGString(svg);
    if (!path) throw new Error("bad path");
    const it = Skia.ContourMeasureIter(path, false, 1);
    const contours: { c: ReturnType<typeof it.next>; len: number }[] = [];
    let total = 0;
    let c = it.next();
    while (c) {
      const len = c.length();
      contours.push({ c, len });
      total += len;
      c = it.next();
    }
    if (total <= 0) throw new Error("empty path");
    const pts: Pt[] = [];
    for (let i = 0; i < n; i++) {
      let d = (i / Math.max(1, n - 1)) * total;
      for (const { c: cc, len } of contours) {
        if (!cc) continue;
        if (d <= len || len === 0) {
          const [pos] = cc.getPosTan(Math.min(d, len));
          pts.push({ x: pos.x, y: pos.y });
          break;
        }
        d -= len;
      }
    }
    while (pts.length < n) pts.push(pts[pts.length - 1] ?? { x: 50, y: 50 });
    return pts;
  } catch {
    // Fallback: a ring, so particles still resolve into a shape.
    return Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      return { x: 50 + Math.cos(a) * 24, y: 50 + Math.sin(a) * 24 };
    });
  }
}

// ---- one drifting ink mote --------------------------------------------------
function InkMote({
  origin,
  target,
  travel,
  radius,
  color,
}: {
  origin: Pt;
  target: Pt;
  travel: SharedValue<number>;
  radius: number;
  color: string;
}) {
  const cx = useDerivedValue(() => lerp(origin.x, target.x, ez(travel.value)));
  const cy = useDerivedValue(() => lerp(origin.y, target.y, ez(travel.value)));
  return <Circle cx={cx} cy={cy} r={radius} color={color} />;
}

export function LivingPage({
  onCreate,
  onSignIn,
}: {
  onCreate: () => void;
  onSignIn: () => void;
}) {
  const { width: W, height: H } = useWindowDimensions();
  const { colors, dark } = useAppTheme();
  const reduceMotion = useReducedMotion();

  const [sceneIndex, setSceneIndex] = useState(0);
  const [wordWidth, setWordWidth] = useState(0);
  const scene = SCENES[sceneIndex];

  // Timeline: one shared value sweeps 0..1 per cycle, then advances the scene.
  const progress = useSharedValue(0);
  const clock = useClock();

  useEffect(() => {
    if (reduceMotion) {
      progress.value = 0.82; // hold on the finished drawing
      return;
    }
    progress.value = 0;
    progress.value = withTiming(
      1,
      { duration: CYCLE_MS, easing: Easing.linear },
      (finished) => {
        if (finished) {
          runOnJS(setSceneIndex)((sceneIndex + 1) % SCENES.length);
        }
      }
    );
    return () => cancelAnimation(progress);
  }, [sceneIndex, reduceMotion, progress]);

  // --- geometry --------------------------------------------------------------
  const artSize = Math.min(W * 0.62, H * 0.3);
  const ox = (W - artSize) / 2;
  const oy = H * 0.4;
  const s = artSize / 100;
  const wordCenterY = H * 0.29;

  const path = useMemo(() => Skia.Path.MakeFromSVGString(scene.svg), [scene.svg]);

  const origins = useMemo<Pt[]>(
    () =>
      Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
        x: W * 0.3 + rnd(i) * (W * 0.4),
        y: wordCenterY + (rnd(i + 9) - 0.5) * 46,
      })),
    [W, wordCenterY]
  );

  const targets = useMemo<Pt[]>(
    () =>
      samplePath(scene.svg, PARTICLE_COUNT).map((p) => ({
        x: ox + p.x * s,
        y: oy + p.y * s,
      })),
    [scene.svg, ox, oy, s]
  );

  // --- animated slices of the timeline --------------------------------------
  const writeP = useDerivedValue(() => ez(seg(progress.value, 0.0, 0.3)));
  const wordLift = useDerivedValue(() => ez(seg(progress.value, 0.4, 0.54)));
  const drawEnd = useDerivedValue(() => ez(seg(progress.value, 0.48, 0.8)));
  const motesTravel = useDerivedValue(() => seg(progress.value, 0.4, 0.74));
  const motesOpacity = useDerivedValue(
    () => seg(progress.value, 0.4, 0.5) * (1 - seg(progress.value, 0.72, 0.84))
  );
  const artOpacity = useDerivedValue(
    () =>
      Math.min(
        seg(progress.value, 0.5, 0.62),
        1 - seg(progress.value, 0.9, 1.0)
      )
  );
  // slow warm breath behind the page
  const breath = useDerivedValue(() => 0.04 + 0.045 * (0.5 + 0.5 * Math.sin(clock.value / 1500)));

  const strokeW = Math.max(1.6, s * 1.4);
  const inkStroke = colors.ink;
  const glow = colors.accent;

  // --- handwriting reveal (RN text, clipped left-to-right) -------------------
  const inkClipStyle = useAnimatedStyle(() => ({ width: writeP.value * wordWidth }));
  const wordGroupStyle = useAnimatedStyle(() => ({
    opacity: 1 - wordLift.value,
    transform: [{ translateY: -wordLift.value * 48 }, { scale: 1 - wordLift.value * 0.04 }],
  }));
  const nibStyle = useAnimatedStyle(() => ({
    left: writeP.value * wordWidth - 5,
    opacity: writeP.value > 0.99 || writeP.value < 0.01 ? 0 : 0.85,
  }));

  // --- swipe-up to peel the page away ---------------------------------------
  const lift = useSharedValue(0);
  const [peeled, setPeeled] = useState(false);

  const commitPeel = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setPeeled(true);
  };

  const pan = Gesture.Pan()
    .activeOffsetY([-12, 12])
    .onUpdate((e) => {
      lift.value = Math.min(1, Math.max(0, -e.translationY / (H * 0.5)));
    })
    .onEnd((e) => {
      const go = lift.value > 0.32 || e.velocityY < -750;
      if (go) {
        lift.value = withTiming(1, { duration: 520, easing: Easing.out(Easing.cubic) });
        runOnJS(commitPeel)();
      } else {
        lift.value = withSpring(0, { damping: 18, stiffness: 160 });
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({
    opacity: 1 - Math.max(0, (lift.value - 0.62) / 0.38),
    transform: [
      { perspective: 900 },
      { translateY: -lift.value * H * 1.15 },
      { rotateX: `${-lift.value * 11}deg` },
      { scale: 1 - lift.value * 0.06 },
    ],
  }));
  const edgeStyle = useAnimatedStyle(() => ({ opacity: Math.min(0.5, lift.value * 1.4) }));
  const hintStyle = useAnimatedStyle(() => ({ opacity: 1 - Math.min(1, lift.value * 3) }));

  const beginByTap = () => {
    lift.value = withTiming(1, { duration: 620, easing: Easing.out(Easing.cubic) }, (f) => {
      if (f) runOnJS(commitPeel)();
    });
    Haptics.selectionAsync().catch(() => {});
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      {/* The auth invitation, revealed as the page lifts away. */}
      <AuthPanel
        colors={colors}
        onCreate={onCreate}
        onSignIn={onSignIn}
        active={peeled}
      />

      {/* The living page itself. */}
      <GestureDetector gesture={pan}>
        <Animated.View
          style={[StyleSheet.absoluteFill, sheetStyle]}
          pointerEvents={peeled ? "none" : "auto"}
        >
          <Canvas style={StyleSheet.absoluteFill}>
            {/* paper: warm center falling to the page edge */}
            <Fill>
              <RadialGradient
                c={vec(W / 2, H * 0.42)}
                r={H * 0.72}
                colors={[colors.panel, colors.bg]}
              />
            </Fill>
            {/* a breath of imagination behind the ink */}
            <Group opacity={breath}>
              <Fill>
                <RadialGradient
                  c={vec(W / 2, wordCenterY + 40)}
                  r={artSize * 1.2}
                  colors={[colors.accent, "rgba(0,0,0,0)"]}
                />
              </Fill>
            </Group>

            {/* ink motes travelling from the words into the drawing */}
            <Group opacity={motesOpacity}>
              {origins.map((o, i) => (
                <InkMote
                  key={i}
                  origin={o}
                  target={targets[i] ?? o}
                  travel={motesTravel}
                  radius={1.3 + rnd(i + 3) * 1.4}
                  color={inkStroke}
                />
              ))}
            </Group>

            {/* the drawing */}
            {path ? (
              <Group
                transform={[{ translateX: ox }, { translateY: oy }, { scale: s }]}
                opacity={artOpacity}
              >
                <Group layer={<Paint><Blur blur={5} /></Paint>} opacity={0.5}>
                  <Path
                    path={path}
                    style="stroke"
                    strokeWidth={strokeW * 1.6}
                    strokeCap="round"
                    strokeJoin="round"
                    color={glow}
                    start={0}
                    end={drawEnd}
                  />
                </Group>
                <Path
                  path={path}
                  style="stroke"
                  strokeWidth={strokeW}
                  strokeCap="round"
                  strokeJoin="round"
                  color={inkStroke}
                  start={0}
                  end={drawEnd}
                />
              </Group>
            ) : null}
          </Canvas>

          {/* wordmark, present from the first frame */}
          <View style={[styles.brandRow, { top: H * 0.12 }]} pointerEvents="none">
            <Text style={[styles.wordmark, { color: colors.ink }]}>Ciciro</Text>
          </View>

          {/* the handwritten line */}
          <Animated.View
            style={[styles.wordWrap, { top: wordCenterY - LINE_H / 2 }, wordGroupStyle]}
            pointerEvents="none"
          >
            <View key={sceneIndex} style={{ height: LINE_H }}>
              <Text
                onLayout={(e) => setWordWidth(e.nativeEvent.layout.width)}
                style={[styles.phrase, { color: colors.ink, opacity: 0.1 }]}
                numberOfLines={1}
              >
                {scene.phrase}
              </Text>
              <Animated.View style={[styles.inkClip, inkClipStyle]}>
                <Text
                  style={[styles.phrase, { color: colors.ink, width: wordWidth || undefined }]}
                  numberOfLines={1}
                >
                  {scene.phrase}
                </Text>
              </Animated.View>
              {/* wet-ink nib at the writing frontier */}
              <Animated.View style={[styles.nib, nibStyle]}>
                <LinearGradient
                  colors={[colors.accent, "rgba(0,0,0,0)"]}
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={StyleSheet.absoluteFill}
                />
              </Animated.View>
            </View>
          </Animated.View>

          {/* lifting-edge shadow that intensifies as you pull the page up */}
          <Animated.View style={[styles.edge, edgeStyle]} pointerEvents="none">
            <LinearGradient
              colors={["rgba(0,0,0,0)", dark ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0.28)"]}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>

          {/* the invitation to begin */}
          <Animated.View style={[styles.hint, { bottom: H * 0.08 }, hintStyle]}>
            <Pressable
              onPress={beginByTap}
              accessibilityRole="button"
              accessibilityLabel="Begin - lift the page to create your account"
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
              <Text style={[styles.hintText, { color: colors.inkSoft }]}>Swipe up to begin</Text>
            </Pressable>
          </Animated.View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

function AuthPanel({
  colors,
  onCreate,
  onSignIn,
  active,
}: {
  colors: ReturnType<typeof useAppTheme>["colors"];
  onCreate: () => void;
  onSignIn: () => void;
  active: boolean;
}) {
  return (
    <View
      style={styles.auth}
      pointerEvents={active ? "auto" : "none"}
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? "auto" : "no-hide-descendants"}
    >
      <Text style={[styles.authMark, { color: colors.ink }]}>Ciciro</Text>
      <Text style={[styles.authLede, { color: colors.inkSoft }]}>
        Turn a sentence into a world.
      </Text>
      <Pressable
        onPress={onCreate}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.primary,
          { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1 },
        ]}
      >
        <Text style={[styles.primaryText, { color: colors.panel }]}>Create your account</Text>
      </Pressable>
      <Pressable onPress={onSignIn} accessibilityRole="button" style={styles.ghost}>
        <Text style={[styles.ghostText, { color: colors.accent }]}>
          I already have an account
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: "hidden" },
  brandRow: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  wordmark: { fontFamily: fonts.serif, fontSize: 18, letterSpacing: 3, textTransform: "uppercase" },
  wordWrap: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  phrase: { fontFamily: fonts.serif, fontSize: WORD_SIZE, fontStyle: "italic", lineHeight: LINE_H },
  inkClip: { position: "absolute", left: 0, top: 0, height: LINE_H, overflow: "hidden" },
  nib: { position: "absolute", top: LINE_H * 0.2, height: LINE_H * 0.6, width: 12 },
  edge: { position: "absolute", left: 0, right: 0, bottom: 0, height: 120 },
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
    marginBottom: 10,
  },
  authLede: { fontFamily: fonts.serif, fontSize: 17, fontStyle: "italic", marginBottom: 40 },
  primary: {
    borderRadius: 10,
    paddingVertical: 15,
    paddingHorizontal: 28,
    alignSelf: "stretch",
    alignItems: "center",
  },
  primaryText: { fontSize: 16, fontWeight: "600" },
  ghost: { paddingVertical: 16, alignItems: "center" },
  ghostText: { fontSize: 15 },
});
