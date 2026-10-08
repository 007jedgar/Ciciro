import { useEffect } from "react";
import type { ComponentProps } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  interpolateColor,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
  ZoomIn,
  type SharedValue,
} from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { EASE_OUT } from "../../lib/motion";
import { useAppTheme } from "../../lib/settings";
import { useReduceMotion } from "../../lib/use-reduce-motion";
import type { OnboardingStep } from "../../lib/onboarding-flow";

const NODE = 10;
const LINE = 2;
const DRAW_MS = 460;

/**
 * A thread with a knot at every step. It is drawn up to the screen you are on
 * each time one arrives (the line takes 460ms, then the new knot pops once), so
 * the flow reads as one line with a start and an end. The reminder step adds a
 * knot, springing in, the moment someone picks "Sitting down consistently".
 */
export function OnboardingThread({ steps, current }: { steps: readonly OnboardingStep[]; current: OnboardingStep }) {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const reduceMotion = useReduceMotion();
  const index = Math.max(0, steps.indexOf(current));
  const total = steps.length;
  // Starts one knot behind and draws forward, so every screen finishes the line.
  const progress = useSharedValue(reduceMotion ? index : Math.max(0, index - 1));
  const pop = useSharedValue(1);

  useEffect(() => {
    if (reduceMotion) {
      progress.value = index;
      return;
    }
    progress.value = withTiming(index, { duration: DRAW_MS, easing: EASE_OUT });
    // The knot you arrive at pops once, as the line reaches it.
    pop.value = withSequence(
      withTiming(1, { duration: DRAW_MS - 140 }),
      withSpring(1.45, { damping: 7, stiffness: 320 }),
      withSpring(1, { damping: 12, stiffness: 240 })
    );
    // Only a change of screen redraws the thread.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, reduceMotion]);

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t("onboarding.progress", { current: index + 1, total })}
      accessibilityValue={{ min: 1, max: total, now: index + 1 }}
      style={styles.row}
    >
      {steps.map((step, i) => (
        <ThreadPiece
          key={step}
          i={i}
          last={i === total - 1}
          isCurrent={i === index}
          progress={progress}
          pop={pop}
          entering={reduceMotion || step !== "reminder" ? undefined : ZoomIn.springify().damping(12)}
          idle={colors.line}
          done={colors.accent}
        />
      ))}
    </View>
  );
}

function ThreadPiece({
  i,
  last,
  isCurrent,
  progress,
  pop,
  entering,
  idle,
  done,
}: {
  i: number;
  last: boolean;
  isCurrent: boolean;
  progress: SharedValue<number>;
  pop: SharedValue<number>;
  entering: ComponentProps<typeof Animated.View>["entering"];
  idle: string;
  done: string;
}) {
  const node = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [i - 0.4, i], [idle, done]),
    transform: [{ scale: isCurrent ? pop.value : 1 }],
  }));
  const fill = useAnimatedStyle(() => ({
    width: `${Math.max(0, Math.min(1, progress.value - i)) * 100}%`,
  }));
  return (
    <>
      <Animated.View entering={entering} layout={LinearTransition.duration(260)} style={[styles.node, node]} />
      {last ? null : (
        <Animated.View layout={LinearTransition.duration(260)} style={[styles.track, { backgroundColor: idle }]}>
          <Animated.View style={[styles.fill, { backgroundColor: done }, fill]} />
        </Animated.View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", height: 20 },
  node: { width: NODE, height: NODE, borderRadius: NODE / 2 },
  track: { flex: 1, height: LINE, borderRadius: LINE / 2, marginHorizontal: 4, overflow: "hidden" },
  fill: { height: LINE },
});
