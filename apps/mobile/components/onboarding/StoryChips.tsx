import { StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { CARRY_FADE_MS } from "../../lib/motion";
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

  return (
    <View
      accessible={summary !== null}
      accessibilityRole="summary"
      accessibilityLabel={summary ?? undefined}
      style={styles.row}
    >
      {chips.map((chip) => (
        <Animated.View
          key={chip.id}
          ref={(node: unknown) => registerChip(chip.id, node as Measurable | null)}
          collapsable={false}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
          entering={reduceMotion ? FadeIn.duration(CARRY_FADE_MS) : undefined}
          exiting={FadeOut.duration(reduceMotion ? CARRY_FADE_MS : 160)}
          layout={reduceMotion ? undefined : LinearTransition.duration(220)}
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
        </Animated.View>
      ))}
    </View>
  );
}

/** What the chip label looks like, for the flight to land on. */
export const chipLabelFont = CHIP_FONT;

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    paddingHorizontal: 20,
    marginTop: 10,
    minHeight: CHIP_HEIGHT,
  },
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
