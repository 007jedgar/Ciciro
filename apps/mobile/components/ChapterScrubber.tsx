import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import * as haptics from "../lib/haptics";
import { EASE_OUT } from "../lib/motion";
import { useReduceMotion } from "../lib/use-reduce-motion";
import { colors as parchmentColors } from "../lib/theme";
import { announce } from "../lib/announce";
import { TapPressable } from "./TapPressable";

type Colors = typeof parchmentColors;

const THUMB = 22;
const SLIDE_MS = 160;
/** Above this many stops, only the ends and the current stop carry a number. */
const LABEL_EVERY_UNTIL = 12;

/**
 * A point in the story to read the who-knows-what ledger at: stop 0 is before
 * the story opens, stop n the end of chapter n. Drag or tap the track, or step
 * with the arrows; each new stop ticks once. Built fresh: nothing else in the
 * app picks a position along the manuscript.
 */
export function ChapterScrubber({
  stops,
  value,
  onChange,
  label,
  colors,
}: {
  /** Chapters plus one, for before the story. */
  stops: number;
  value: number;
  onChange: (stop: number) => void;
  /** What the current stop reads as, e.g. "As of the end of Ch. 3: The Attic". */
  label: string;
  colors: Colors;
}) {
  const { t } = useTranslation();
  const reduceMotion = useReduceMotion();
  const [width, setWidth] = useState(0);
  const last = Math.max(stops - 1, 0);
  const current = useRef(value);
  current.current = value;

  const thumbX = useSharedValue(0);
  const target = last > 0 && width > 0 ? (value / last) * width : 0;
  useEffect(() => {
    const duration = reduceMotion ? 0 : SLIDE_MS;
    thumbX.value = withTiming(target, { duration, easing: EASE_OUT });
  }, [target, reduceMotion, thumbX]);
  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: thumbX.value }] }));

  function choose(stop: number) {
    const next = Math.max(0, Math.min(last, stop));
    if (next === current.current) return;
    current.current = next;
    haptics.select();
    onChange(next);
  }

  // Set by the earlier/later buttons: VoiceOver stays on the button, so the new stop is spoken once it lands.
  const speakNextStop = useRef(false);
  useEffect(() => {
    if (speakNextStop.current) {
      speakNextStop.current = false;
      announce(label);
    }
  }, [label]);
  function step(delta: number) {
    speakNextStop.current = true;
    choose(value + delta);
  }

  function pick(x: number) {
    if (width <= 0 || last === 0) return;
    choose(Math.round((x / width) * last));
  }

  // Taps jump; horizontal drags slide. A vertical drag is the page scrolling.
  const pan = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-6, 6])
    .failOffsetY([-12, 12])
    .onStart((e) => pick(e.x - THUMB / 2))
    .onUpdate((e) => pick(e.x - THUMB / 2));
  const tap = Gesture.Tap()
    .runOnJS(true)
    .onEnd((e) => pick(e.x - THUMB / 2));

  const showNumber = (stop: number) =>
    stops <= LABEL_EVERY_UNTIL || stop === 0 || stop === last || stop === value;

  return (
    <View style={[styles.card, { borderColor: colors.line, backgroundColor: colors.panel }]}>
      <View style={styles.head}>
        <TapPressable
          onPress={() => step(-1)}
          disabled={value <= 0}
          accessibilityRole="button"
          accessibilityLabel={t("bible.knowledge.earlier")}
          hitSlop={10}
          style={{ opacity: value <= 0 ? 0.3 : 1 }}
        >
          <Text style={[styles.arrow, { color: colors.accent }]}>‹</Text>
        </TapPressable>
        <Text
          style={[styles.label, { color: colors.ink }]}
          numberOfLines={2}
          accessibilityLiveRegion="polite"
          testID="knowledge-as-of"
        >
          {label}
        </Text>
        <TapPressable
          onPress={() => step(1)}
          disabled={value >= last}
          accessibilityRole="button"
          accessibilityLabel={t("bible.knowledge.later")}
          hitSlop={10}
          style={{ opacity: value >= last ? 0.3 : 1 }}
        >
          <Text style={[styles.arrow, { color: colors.accent }]}>›</Text>
        </TapPressable>
      </View>

      <GestureDetector gesture={Gesture.Race(pan, tap)}>
        <View
          style={styles.hit}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={t("bible.knowledge.scrubberA11y")}
          accessibilityValue={{ text: label }}
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={(e) => choose(value + (e.nativeEvent.actionName === "increment" ? 1 : -1))}
        >
          <View
            style={styles.trackBox}
            onLayout={(e: LayoutChangeEvent) => setWidth(Math.max(0, e.nativeEvent.layout.width - THUMB))}
          >
            <View style={[styles.track, { backgroundColor: colors.line }]} />
            {Array.from({ length: stops }, (_, stop) => (
              <View
                key={stop}
                style={[
                  styles.tick,
                  {
                    left: THUMB / 2 + (last > 0 ? (stop / last) * width : 0) - 2,
                    backgroundColor: stop <= value ? colors.accent : colors.inkSoft,
                  },
                ]}
              />
            ))}
            <Animated.View
              style={[
                styles.thumb,
                { backgroundColor: colors.accent, borderColor: colors.panel },
                thumbStyle,
              ]}
            />
          </View>
          <View style={styles.numbers}>
            {Array.from({ length: stops }, (_, stop) =>
              showNumber(stop) ? (
                <Text
                  key={stop}
                  style={[
                    styles.number,
                    {
                      left: (last > 0 ? (stop / last) * width : 0) + THUMB / 2 - 14,
                      color: stop === value ? colors.accent : colors.inkSoft,
                      fontWeight: stop === value ? "700" : "400",
                    },
                  ]}
                >
                  {stop === 0 ? "•" : String(stop)}
                </Text>
              ) : null
            )}
          </View>
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6, marginBottom: 14 },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  arrow: { fontSize: 26, lineHeight: 28, paddingHorizontal: 4 },
  label: { flex: 1, textAlign: "center", fontSize: 15, fontWeight: "600" },
  hit: { paddingTop: 6 },
  trackBox: { height: 32, justifyContent: "center" },
  track: { position: "absolute", left: THUMB / 2, right: THUMB / 2, height: 2, borderRadius: 1 },
  tick: { position: "absolute", width: 4, height: 4, borderRadius: 2 },
  thumb: {
    position: "absolute",
    left: 0,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    borderWidth: 3,
  },
  numbers: { height: 16 },
  number: { position: "absolute", width: 28, textAlign: "center", fontSize: 11, fontVariant: ["tabular-nums"] },
});
