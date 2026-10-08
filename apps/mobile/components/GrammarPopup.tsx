import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import {
  autoAcceptProgress,
  GRAMMAR_AUTO_ACCEPT_MS,
} from "../lib/grammar";
import { EASE_OUT } from "../lib/motion";
import { useOptionalAppTheme } from "../lib/settings";
import { colors as parchmentColors, fonts } from "../lib/theme";
import { Glass, alpha } from "./Glass";
import { TapPressable } from "./TapPressable";

function clip(value: string, max = 48): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

export function GrammarPopup({
  original,
  replacement,
  shownAt,
  durationMs = GRAMMAR_AUTO_ACCEPT_MS,
  reduceMotion = false,
  onAccept,
  onIgnore,
  now = Date.now,
}: {
  original: string;
  replacement: string;
  shownAt: number;
  durationMs?: number;
  reduceMotion?: boolean;
  onAccept: () => void;
  onIgnore: () => void;
  now?: () => number;
}) {
  const { t } = useTranslation();
  const themed = useOptionalAppTheme();
  const colors = themed?.colors ?? parchmentColors;
  const dark = themed?.dark ?? false;
  // `progress` only feeds the accessibility value and the spoken seconds, a few times a second. The bar itself
  // fills on the UI thread (below), so a busy JS thread cannot make it stutter.
  const [progress, setProgress] = useState(() => autoAcceptProgress(shownAt, durationMs, now()));
  const fill = useSharedValue(progress);
  const enter = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    const tick = () => setProgress(autoAcceptProgress(shownAt, durationMs, now()));
    tick();
    const id = setInterval(tick, A11Y_TICK_MS);
    return () => clearInterval(id);
  }, [shownAt, durationMs, now]);

  useEffect(() => {
    const start = autoAcceptProgress(shownAt, durationMs, now());
    fill.value = start;
    // Reduce motion keeps the meter determinate but steps it with `progress` instead of sweeping.
    if (reduceMotion || start >= 1) return;
    fill.value = withTiming(1, { duration: (1 - start) * durationMs, easing: Easing.linear });
  }, [shownAt, durationMs, reduceMotion, now, fill]);

  useEffect(() => {
    if (reduceMotion) fill.value = progress;
  }, [reduceMotion, progress, fill]);

  useEffect(() => {
    enter.value = reduceMotion ? 1 : withTiming(1, { duration: ENTER_MS, easing: EASE_OUT });
  }, [reduceMotion, enter]);

  const fillStyle = useAnimatedStyle(() => ({ width: `${fill.value * 100}%` }));
  const enterStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ scale: ENTER_FROM_SCALE + (1 - ENTER_FROM_SCALE) * enter.value }],
  }));

  function choose(action: () => void) {
    action();
  }

  const seconds = Math.max(0, Math.ceil((1 - progress) * (durationMs / 1000)));

  return (
    <Animated.View style={enterStyle}>
      <Glass dark={dark} colors={colors} radius={20} style={styles.panel}>
        <View
          testID="grammar-popup"
          accessibilityRole="summary"
          accessibilityLabel={t("manuscript.grammarA11y", {
            original: clip(original),
            replacement: clip(replacement),
          })}
          style={styles.body}
        >
          <View
            testID="grammar-auto-accept"
            accessibilityRole="progressbar"
            accessibilityLabel={t("manuscript.grammarAutoAcceptA11y", { seconds })}
            accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
            style={[styles.track, { backgroundColor: alpha(colors.line, dark ? 0.5 : 0.35) }]}
          >
            <Animated.View style={[styles.fill, { backgroundColor: colors.accent }, fillStyle]} />
          </View>
          <Text style={[styles.sample, { color: colors.inkSoft }]} numberOfLines={2}>
            <Text style={styles.original}>{clip(original)}</Text>
            {"  →  "}
            <Text style={[styles.replacement, { color: colors.accent }]}>{clip(replacement)}</Text>
          </Text>
          <View style={styles.actions}>
            <TapPressable
              feedback="dim"
              testID="grammar-ignore"
              accessibilityRole="button"
              accessibilityLabel={t("manuscript.grammarIgnore")}
              onPress={() => choose(onIgnore)}
              style={styles.btn}
            >
              <Text style={[styles.btnLabel, { color: colors.inkSoft }]}>
                {t("manuscript.grammarIgnore")}
              </Text>
            </TapPressable>
            <TapPressable
              testID="grammar-accept"
              accessibilityRole="button"
              accessibilityLabel={t("manuscript.grammarAccept")}
              onPress={() => choose(onAccept)}
              style={[
                styles.btn,
                { backgroundColor: alpha(colors.accent, dark ? 0.28 : 0.16) },
              ]}
            >
              <Text style={[styles.btnLabel, styles.acceptLabel, { color: colors.accent }]}>
                {t("manuscript.grammarAccept")}
              </Text>
            </TapPressable>
          </View>
        </View>
      </Glass>
    </Animated.View>
  );
}

/** The accessibility value and spoken seconds refresh this often. */
const A11Y_TICK_MS = 250;
/** The popup eases in: fades up from a slightly smaller size. */
const ENTER_MS = 180;
const ENTER_FROM_SCALE = 0.94;

const styles = StyleSheet.create({
  panel: { paddingHorizontal: 14, paddingVertical: 12, maxWidth: 320 },
  body: { gap: 10 },
  track: { height: 4, borderRadius: 999, overflow: "hidden" },
  fill: { height: 4, borderRadius: 999 },
  sample: { fontFamily: fonts.serif, fontSize: 16, lineHeight: 22 },
  original: { textDecorationLine: "line-through" },
  replacement: { fontWeight: "600" },
  actions: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 8 },
  btn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 12 },
  btnLabel: { fontSize: 15, fontWeight: "500" },
  acceptLabel: { fontWeight: "600" },
});
