import type { ReactNode } from "react";
import { ScrollView, Text, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown, type AnimatedStyle } from "react-native-reanimated";
import { WriteInTitle } from "./WriteInTitle";
import { fadeUpDelay } from "../../lib/skeleton";
import { useOnboardingChrome } from "../../lib/onboarding-shell";
import { useAppTheme } from "../../lib/settings";
import { useReduceMotion } from "../../lib/use-reduce-motion";
import type { OnboardingStep } from "../../lib/onboarding-flow";

const RISE_MS = 260;

/** One block of an onboarding screen: rises into place, `index` steps behind the one before it (60ms apart). */
export function Rise({
  index,
  children,
  style,
}: {
  index: number;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReduceMotion();
  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeInDown.duration(RISE_MS).delay(fadeUpDelay(index))}
      style={style}
    >
      {children}
    </Animated.View>
  );
}

/**
 * The shared skeleton of the quiz screens: a title that writes itself in, then
 * the content rising in one block at a time (the title is block 0). `footer`
 * pins to the bottom, above the home indicator, and rises last. The header
 * above it (back, the progress thread, Skip, the answer chips) is not here: it
 * belongs to the onboarding layout and stays put between steps - this only tells
 * it where the screen sits and what back and Skip do. `leave` fades the whole
 * screen when a card flies off it (see `useCarry`).
 */
export function OnboardingFrame({
  steps,
  step,
  title,
  body,
  onBack,
  onSkip,
  leave,
  footer,
  children,
}: {
  steps: readonly OnboardingStep[];
  step: OnboardingStep;
  title: string;
  body?: string;
  onBack: () => void;
  onSkip: () => void;
  leave?: StyleProp<AnimatedStyle<StyleProp<ViewStyle>>>;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const { layout } = useAppTheme();
  const insets = useSafeAreaInsets();
  useOnboardingChrome({ step, steps, onBack, onSkip });
  return (
    <Animated.View style={[{ flex: 1 }, leave]}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 22, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <WriteInTitle text={title} style={[layout.title, { marginBottom: body ? 8 : 20 }]} />
        {body ? (
          <Rise index={1}>
            <Text style={[layout.body, { marginBottom: 20 }]}>{body}</Text>
          </Rise>
        ) : null}
        {children}
      </ScrollView>
      {footer ? (
        <Rise index={6} style={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 20, paddingTop: 8 }}>
          {footer}
        </Rise>
      ) : null}
    </Animated.View>
  );
}
