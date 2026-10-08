import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { FREQ_HOLD_MS } from "../lib/motion";
import { useAppTheme } from "../lib/settings";
import { fonts } from "../lib/theme";
import { useReduceMotion } from "../lib/use-reduce-motion";
import {
  COUNT_SLOT,
  PERIOD_SLOT,
  frequencyEntries,
  splitSentence,
  typewriterSteps,
  type FrequencyEntry,
  type FrequencyPeriod,
} from "../lib/writing-frequency";
import { TapPressable } from "./TapPressable";

type Slot = "count" | "period";
type Texts = Record<Slot, string>;

/** How long the caret lingers after the last letter before it goes. */
const CARET_LINGER_MS = 260;
const CARET_BLINK_MS = 520;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function BrandCaret({ color, size }: { color: string; size: number }) {
  const blink = useSharedValue(1);
  useEffect(() => {
    blink.value = withRepeat(withTiming(0.25, { duration: CARET_BLINK_MS, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [blink]);
  const style = useAnimatedStyle(() => ({ opacity: blink.value }));
  return (
    <Animated.View
      style={[styles.caret, { height: size * 0.82, backgroundColor: color }, style]}
      testID="frequency-caret"
    />
  );
}

/**
 * "You've written twice this week": a calm count of the days the writer wrote,
 * for the week, month and year in turn. The line rests for `FREQ_HOLD_MS`, then
 * deletes the part that changes a letter at a time and types the next, with
 * the brand caret, so each change is a small finished act of writing. A tap
 * jumps ahead. Reduce motion stops the cycling and swaps instantly on tap. A
 * period with nothing in it is skipped, never scolded.
 */
export function WritingFrequencyLine({ counts }: { counts: Record<FrequencyPeriod, number> }) {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const reduceMotion = useReduceMotion();
  const entries = useMemo(
    () => frequencyEntries(counts),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [counts.week, counts.month, counts.year]
  );
  const [index, setIndex] = useState(0);
  const entry: FrequencyEntry | null = entries.length > 0 ? (entries[index % entries.length] ?? null) : null;

  const target: Texts | null = entry ? slotTexts(t, entry) : null;
  const [shown, setShown] = useState<Texts>(target ?? { count: "", period: "" });
  const shownRef = useRef(shown);
  const [typing, setTyping] = useState<Slot | null>(null);
  const [settled, setSettled] = useState(0);
  const busy = useRef(false);

  const parts = useMemo(
    () => splitSentence(t("writingHistory.frequency.sentence", { what: COUNT_SLOT, when: PERIOD_SLOT })),
    [t]
  );
  const order = useMemo(() => parts.filter((p) => p.kind !== "text").map((p) => p.kind as Slot), [parts]);

  const targetCount = target?.count;
  const targetPeriod = target?.period;
  useEffect(() => {
    if (targetCount === undefined || targetPeriod === undefined) return;
    const want: Texts = { count: targetCount, period: targetPeriod };
    const apply = (next: Texts) => {
      shownRef.current = next;
      setShown(next);
    };
    if (reduceMotion) {
      apply(want);
      setTyping(null);
      setSettled((n) => n + 1);
      return;
    }
    let cancelled = false;
    busy.current = true;
    void (async () => {
      for (const slot of order) {
        const steps = typewriterSteps(shownRef.current[slot], want[slot]);
        if (steps.length === 0) continue;
        setTyping(slot);
        for (const step of steps) {
          await sleep(step.delayMs);
          if (cancelled) return;
          apply({ ...shownRef.current, [slot]: step.text });
        }
        await sleep(CARET_LINGER_MS);
        if (cancelled) return;
      }
      setTyping(null);
      busy.current = false;
      setSettled((n) => n + 1);
    })();
    return () => {
      cancelled = true;
      busy.current = false;
    };
  }, [targetCount, targetPeriod, reduceMotion, order]);

  // After each change settles the line holds, then moves to the next period on its own (not under Reduce motion).
  useEffect(() => {
    if (entries.length < 2 || reduceMotion || busy.current) return;
    const timer = setTimeout(() => setIndex((i) => i + 1), FREQ_HOLD_MS);
    return () => clearTimeout(timer);
  }, [settled, index, entries.length, reduceMotion]);

  if (!entry || !target) {
    return (
      <Text style={[styles.line, { color: colors.inkSoft }]} testID="frequency-empty">
        {t("writingHistory.frequency.empty")}
      </Text>
    );
  }

  const sentence = parts.map((p) => (p.kind === "text" ? p.text : target[p.kind])).join("");
  const canAdvance = entries.length > 1;
  return (
    <TapPressable
      feedback="dim"
      onPress={() => {
        if (canAdvance && !busy.current) setIndex((i) => i + 1);
      }}
      disabled={!canAdvance}
      accessibilityRole={canAdvance ? "button" : "text"}
      accessibilityLabel={sentence}
      accessibilityHint={canAdvance ? t("writingHistory.frequency.hint") : undefined}
      testID="frequency-line"
    >
      <Text style={[styles.line, { color: colors.ink }]}>
        {parts.map((part, i) =>
          part.kind === "text" ? (
            part.text
          ) : (
            <Text key={i} style={{ color: part.kind === "period" ? colors.accent : colors.ink }}>
              {shown[part.kind]}
              {typing === part.kind ? <BrandCaret color={colors.accent} size={LINE_SIZE} /> : null}
            </Text>
          )
        )}
      </Text>
    </TapPressable>
  );
}

function slotTexts(t: (key: string, opts?: Record<string, unknown>) => string, entry: FrequencyEntry): Texts {
  const count =
    entry.count === 1
      ? t("writingHistory.frequency.once")
      : entry.count === 2
        ? t("writingHistory.frequency.twice")
        : t("writingHistory.frequency.times", { n: entry.count });
  const period = t(
    entry.period === "week"
      ? "writingHistory.frequency.thisWeek"
      : entry.period === "month"
        ? "writingHistory.frequency.thisMonth"
        : "writingHistory.frequency.thisYear"
  );
  return { count, period };
}

const LINE_SIZE = 26;
const styles = StyleSheet.create({
  line: { fontFamily: fonts.display, fontSize: LINE_SIZE, lineHeight: 34, letterSpacing: -0.3 },
  caret: { width: 2, borderRadius: 1, marginLeft: 2 },
});
