import { StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { CARRY_FADE_MS, CARRY_LEAVE_MS, EASE_OUT } from "../../lib/motion";
import { answersSummary } from "../../lib/onboarding-story";
import { useOnboardingShell, type Measurable } from "../../lib/onboarding-shell";
import { useAppTheme } from "../../lib/settings";
import { fonts } from "../../lib/theme";
import { useReduceMotion } from "../../lib/use-reduce-motion";

/** The chip every flight lands in: a calm pill, one line. */
export const CHIP_HEIGHT = 28;
export const CHIP_LABEL_SIZE = 13;
export const CHIP_PADDING_X = 11;
const CHIP_BORDER = 1;
const CHIP_FONT = fonts.uiMedium;

/**
 * The story so far: one chip per answer, in the header under the progress
 * thread. The row keeps its height while empty, so nothing below it moves when
 * the first chip lands. A screen reader gets the row as one summary ("Your
 * answers: Novel, Finding time"), not a button per chip.
 */
export function StoryChips() {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const reduceMotion = useReduceMotion();
  const { chips, hidden, registerChip, registerLabel } = useOnboardingShell();
  const summary = answersSummary(chips, (answers) => t("onboarding.answersSummary", { answers }));
  // The row grows a line when the chips wrap. The screen below slides down with it
  // instead of jumping, and the chips themselves are already where they will be.
  const height = useSharedValue(CHIP_HEIGHT);
  const grow = useAnimatedStyle(() => ({ height: height.value }));
  const onLayout = (event: LayoutChangeEvent) => {
    const next = Math.max(CHIP_HEIGHT, event.nativeEvent.layout.height);
    if (reduceMotion) height.value = next;
    // Growing waits for the screen it leaves to have faded: the card it is flying from is
    // still there until then, and must not slide away from its own floating copy.
    else if (next > height.value) height.value = withDelay(CARRY_LEAVE_MS, withTiming(next, { duration: ROW_GROW_MS, easing: EASE_OUT }));
    else height.value = withTiming(next, { duration: ROW_GROW_MS, easing: EASE_OUT });
  };

  return (
    <Animated.View style={[styles.outer, grow]}>
      <View
        onLayout={onLayout}
        accessible={summary !== null}
        accessibilityRole="summary"
        accessibilityLabel={summary ?? undefined}
        style={styles.row}
      >
        {chips.map((chip) => (
          // The animations live on a wrapper: the chip's own style carries its opacity.
          <Animated.View
            key={chip.id}
            ref={(node: unknown) => registerChip(chip.id, node as Measurable | null)}
            collapsable={false}
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
            entering={reduceMotion ? FadeIn.duration(CARRY_FADE_MS) : undefined}
            exiting={FadeOut.duration(reduceMotion ? CARRY_FADE_MS : 160)}
            layout={reduceMotion ? undefined : LinearTransition.duration(220)}
            style={styles.slot}
          >
            <View
              style={[
                styles.chip,
                { backgroundColor: colors.panel, borderColor: colors.line },
                { opacity: hidden.has(chip.id) ? 0 : 1 },
              ]}
            >
              <Text
                ref={(node: unknown) => registerLabel(chip.id, node as Measurable | null)}
                numberOfLines={1}
                style={[styles.label, { color: colors.ink }]}
              >
                {chip.label}
              </Text>
            </View>
          </Animated.View>
        ))}
      </View>
    </Animated.View>
  );
}

/** What the chip label looks like, for the flight to land on. */
export const chipLabelFont = CHIP_FONT;

const ROW_GROW_MS = 220;

const styles = StyleSheet.create({
  outer: { marginTop: 10 },
  // Out of the flow, so its own height is the natural one however far the row above it has opened.
  row: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    paddingHorizontal: 20,
    minHeight: CHIP_HEIGHT,
  },
  slot: { maxWidth: "100%" },
  chip: {
    height: CHIP_HEIGHT,
    borderRadius: CHIP_HEIGHT / 2,
    borderWidth: CHIP_BORDER,
    paddingHorizontal: CHIP_PADDING_X,
    justifyContent: "center",
    maxWidth: "100%",
  },
  label: { fontFamily: CHIP_FONT, fontSize: CHIP_LABEL_SIZE, lineHeight: 17 },
});
