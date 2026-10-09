import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState, Platform, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { useIsFocused } from "expo-router";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { mixColors } from "../lib/color";
import {
  BAR_HEIGHT,
  HANDOFF,
  handoffClock,
  setWelcomeTargets,
  useHandoffPhase,
} from "../lib/splash-handoff";
import { useAppTheme } from "../lib/settings";
import { fonts, type ColorTokens } from "../lib/theme";
import { useReduceMotion } from "../lib/use-reduce-motion";
import { useWelcomeFrame } from "../lib/use-welcome-frame";
import { headlineLines, welcomeCopy } from "../lib/welcome-copy";
import { CARD_ROLES, headlineSentence, type CardRole, type HeadlineFrame, type HeadlinePart } from "../lib/welcome-script";
import { easeOut, seg } from "../lib/worklet-math";
import { LanguagePicker } from "./LanguagePicker";
import { TapPressable } from "./TapPressable";

const HEAD_SIZE = 38;
const HEAD_LINE = 42;
/** The card's first line: the dots land on three lines this far apart and the first becomes the caret. */
const FIRST_LINE = 24;
const BAR_SPACING = 32;
const BAR_WIDTHS = [1, 0.88, 0.59] as const;

function roleStyle(role: CardRole, colors: ColorTokens): TextStyle {
  switch (role) {
    case "prose":
      return { fontFamily: fonts.displayRegular, fontSize: 16, lineHeight: FIRST_LINE, color: colors.ink };
    case "date":
      return { fontFamily: fonts.mono, fontSize: 10.5, lineHeight: 18, letterSpacing: 1.1, textTransform: "uppercase", color: colors.inkSoft };
    case "title":
      return { fontFamily: fonts.displayRegular, fontSize: 22, lineHeight: 27, color: colors.ink };
    case "subtitle":
      return { fontFamily: fonts.ui, fontSize: 12.5, lineHeight: 18, color: colors.inkSoft };
    case "body":
      return { fontFamily: fonts.displayRegular, fontSize: 15, lineHeight: 22, color: colors.ink };
    case "scene":
      return { fontFamily: fonts.mono, fontSize: 12, lineHeight: 19, textTransform: "uppercase", color: colors.ink };
    case "action":
      return { fontFamily: fonts.mono, fontSize: 12, lineHeight: 19, color: colors.ink };
    case "character":
      return { fontFamily: fonts.mono, fontSize: 12, lineHeight: 19, textTransform: "uppercase", color: colors.ink, marginLeft: "41%" };
    case "dialogue":
      return { fontFamily: fonts.mono, fontSize: 12, lineHeight: 19, color: colors.ink, marginLeft: "20%", width: "72%" };
  }
}

/** A part of the welcome screen that rises in on the hand-off clock, one `index` after another. */
function Rise({ index, style, children }: { index: number; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const start = HANDOFF.riseStartMs + index * HANDOFF.riseStaggerMs;
  const end = start + HANDOFF.riseMs;
  const animated = useAnimatedStyle(() => {
    const p = easeOut(seg(handoffClock.value, start, end));
    return { opacity: p, transform: [{ translateY: (1 - p) * 14 }] };
  });
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

/** The writing caret, inline in the text: it blinks while the page waits and holds still while typing. */
function TypingCaret({ color, height, blink }: { color: string; height: number; blink: boolean }) {
  const opacity = useSharedValue(1);
  useEffect(() => {
    cancelAnimation(opacity);
    opacity.value = 1;
    if (blink) {
      opacity.value = withRepeat(
        withSequence(withDelay(520, withTiming(0, { duration: 1 })), withDelay(520, withTiming(1, { duration: 1 }))),
        -1
      );
    }
    return () => cancelAnimation(opacity);
  }, [blink, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      testID="welcome-caret"
      style={[{ width: 3, height, borderRadius: 1.5, backgroundColor: color, marginHorizontal: 1 }, style]}
    />
  );
}

/** One part of the headline, with the highlight or the caret where the script has put them. */
function headlinePart(
  h: HeadlineFrame,
  part: HeadlinePart,
  tint: string,
  caret: ReactNode
): ReactNode {
  const text = h[part];
  if (h.selection?.part === part) {
    return [
      text.slice(0, h.selection.from),
      <Text key="selection" style={{ backgroundColor: tint }}>
        {text.slice(h.selection.from, h.selection.to)}
      </Text>,
      text.slice(h.selection.to),
    ];
  }
  if (h.caret?.part === part) return [text.slice(0, h.caret.at), caret, text.slice(h.caret.at)];
  return text;
}

/**
 * The first screen a signed-out author sees. Behind the splash it builds
 * itself (`lib/splash-handoff.ts`): the dots land as the card's first three
 * lines, which shrink to a caret and type a page; then a caret rewrites the
 * headline ("Keep writing the book you've been meaning to.") and the headline's
 * word and the card's page change together through every kind of writing
 * (`lib/welcome-script.ts`). The headline reads to a screen reader as the one
 * finished sentence, never keystroke by keystroke; the loop is paused while the
 * screen is not focused or the app is in the background; Reduce motion shows
 * finished pages that crossfade.
 */
export function WelcomeScreen({ onCreate, onSignIn }: { onCreate: () => void; onSignIn: () => void }) {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { t, i18n } = useTranslation();
  const reduceMotion = useReduceMotion();
  const phase = useHandoffPhase();
  const focused = useIsFocused();
  const [appActive, setAppActive] = useState(AppState.currentState !== "background" && AppState.currentState !== "inactive");

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => setAppActive(state === "active"));
    return () => sub.remove();
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const copy = useMemo(() => welcomeCopy(t), [t, i18n.language]);
  const lines = headlineLines(t);
  const { frame, swapping } = useWelcomeFrame(copy, { play: phase === "done" && focused && appActive, reduceMotion });
  const sentence = headlineSentence(copy);
  // The italic face is Latin only: Devanagari and Chinese fall back to a heavier system face when asked for it.
  const italicWord = i18n.language === "en" || i18n.language === "es";

  // Where the card's first three lines are, so the splash's dots know where to land.
  const copyRef = useRef<View>(null);
  const measure = useCallback(() => {
    copyRef.current?.measureInWindow((x, y, width) => {
      if (!width) return;
      const bar = (i: number) => ({ x, y: y + FIRST_LINE / 2 + i * BAR_SPACING - BAR_HEIGHT / 2, width: width * BAR_WIDTHS[i] });
      setWelcomeTargets({ bars: [bar(0), bar(1), bar(2)], caretTop: y, caretHeight: FIRST_LINE });
    });
  }, []);
  useEffect(() => {
    const frameId = requestAnimationFrame(measure);
    return () => {
      cancelAnimationFrame(frameId);
      setWelcomeTargets(null);
    };
  }, [measure]);

  // Reduce motion crossfades the page when it swaps to the next kind.
  const swap = useSharedValue(1);
  useEffect(() => {
    swap.value = withTiming(swapping ? 0 : 1, { duration: 160 });
  }, [swapping, swap]);
  const swapStyle = useAnimatedStyle(() => ({ opacity: swap.value }));

  const cardStart = HANDOFF.riseStartMs + 3 * HANDOFF.riseStaggerMs;
  const cardEnd = cardStart + HANDOFF.riseMs;
  // The card fades in without moving: the dots are landing on its lines.
  const cardStyle = useAnimatedStyle(() => ({ opacity: seg(handoffClock.value, cardStart, cardEnd) }));

  const selectionOnBg = mixColors(colors.bg, colors.accent, 0.28);
  const selectionOnPanel = mixColors(colors.panel, colors.accent, 0.28);
  const h = frame.headline;
  const caret = <TypingCaret key="caret" color={colors.accent} height={HEAD_SIZE * 0.82} blink={h.blink} />;
  const kind = frame.card.kind;
  const roles = CARD_ROLES[kind];

  return (
    <View
      style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top + 12, paddingBottom: Math.max(insets.bottom, 14) + 8 }]}
      onLayout={measure}
    >
      <View style={styles.topSpacer} />

      <Rise index={0} style={styles.eyebrowRow}>
        <View style={[styles.eyebrowDot, { backgroundColor: colors.vermilion }]} />
        <Text style={[styles.eyebrow, { color: colors.inkSoft }]}>{t("welcome.eyebrow")}</Text>
      </Rise>

      <Rise index={1}>
        <Animated.View
          accessible
          accessibilityRole="header"
          accessibilityLabel={sentence}
          style={[{ minHeight: HEAD_LINE * lines }, swapStyle]}
        >
          <Text
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
            style={[styles.headline, { color: colors.ink }]}
          >
            {headlinePart(h, "before", selectionOnBg, caret)}
            <Text style={italicWord ? styles.word : undefined}>{headlinePart(h, "word", selectionOnBg, caret)}</Text>
            {headlinePart(h, "after", selectionOnBg, caret)}
          </Text>
        </Animated.View>
      </Rise>

      <Rise index={2}>
        <Text style={[styles.sub, { color: colors.inkSoft }]}>{t("welcome.sub")}</Text>
      </Rise>

      <Animated.View
        style={[
          styles.card,
          { backgroundColor: colors.panel, borderColor: colors.line, shadowColor: colors.ink },
          cardStyle,
        ]}
        onLayout={measure}
        // The page is a demonstration of what Ciciro is for, not content: a screen reader skips it.
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <View style={[styles.margin, { backgroundColor: mixColors(colors.panel, colors.vermilion, 0.45) }]} />
        <Animated.Text style={[styles.cardLabel, { color: colors.inkSoft }, swapStyle]}>{frame.card.label}</Animated.Text>
        <View ref={copyRef} collapsable={false} onLayout={measure} style={styles.copy}>
          <Animated.View style={swapStyle}>
            {roles.map((role, i) => {
              const typed = frame.card.typed[i];
              if (typed === undefined) return null;
              const look = roleStyle(role, colors);
              return (
                <Text key={`${kind}-${i}`} style={[look, i > 0 ? styles.blockGap : null]}>
                  <Text style={frame.card.selected ? { backgroundColor: selectionOnPanel } : undefined}>{typed}</Text>
                  {frame.card.caret === i ? <TypingCaret color={colors.accent} height={(look.fontSize ?? 16) * 1.12} blink={false} /> : null}
                </Text>
              );
            })}
          </Animated.View>
        </View>
      </Animated.View>

      <View style={styles.spacer} />

      <Rise index={4} style={styles.primaryWrap}>
        <TapPressable onPress={onCreate} style={[styles.primary, { backgroundColor: colors.ink }]}>
          <Text style={[styles.primaryText, { color: colors.bg }]}>{t("welcome.createAccount")}</Text>
        </TapPressable>
      </Rise>
      <Rise index={5}>
        <TapPressable feedback="dim" onPress={onSignIn} style={styles.ghost}>
          <Text style={[styles.ghostText, { color: colors.inkSoft }]}>{t("welcome.alreadyHaveAccount")}</Text>
        </TapPressable>
      </Rise>

      <Rise index={6} style={styles.langs}>
        <LanguagePicker variant="inline" />
      </Rise>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 28 },
  eyebrowRow: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  eyebrowDot: { width: 7, height: 7, borderRadius: 3.5, marginRight: 8 },
  eyebrow: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase" },
  headline: { fontFamily: fonts.display, fontSize: HEAD_SIZE, lineHeight: HEAD_LINE, letterSpacing: -0.5 },
  // iOS flattens an italic face to upright unless the style says italic too; Android's file is already the italic.
  word: { fontFamily: fonts.displayItalic, ...(Platform.OS === "ios" ? { fontStyle: "italic" as const } : {}) },
  sub: { fontFamily: fonts.ui, fontSize: 15, lineHeight: 22, marginTop: 14, marginBottom: 22, maxWidth: 330 },
  card: {
    flexGrow: 1,
    flexShrink: 1,
    minHeight: 170,
    maxHeight: 300,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    shadowOpacity: 0.14,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  margin: { position: "absolute", left: 31, top: 0, bottom: 0, width: StyleSheet.hairlineWidth },
  cardLabel: { position: "absolute", left: 50, top: 22, fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase" },
  copy: { position: "absolute", left: 50, top: 66, right: 14 },
  blockGap: { marginTop: 6 },
  topSpacer: { flexGrow: 1, flexShrink: 1, minHeight: 24 },
  spacer: { flexGrow: 1.2, flexShrink: 1, minHeight: 22 },
  primaryWrap: {},
  primary: { height: 54, borderRadius: 27, alignItems: "center", justifyContent: "center" },
  primaryText: { fontFamily: fonts.uiBold, fontSize: 16 },
  ghost: { height: 44, alignItems: "center", justifyContent: "center" },
  ghostText: { fontFamily: fonts.uiMedium, fontSize: 14 },
  langs: { marginTop: 4 },
});
