import type { ReactNode } from "react";
import { ScrollView, Text, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";
import { ThemeWashScope } from "../ThemeWashScope";
import { OnboardingHeader } from "./OnboardingHeader";
import { OnboardingThread } from "./OnboardingThread";
import { WriteInTitle } from "./WriteInTitle";
import { fadeUpDelay } from "../../lib/skeleton";
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
 * The shared skeleton of the quiz screens: back, the progress thread and Skip
 * on top, a title that writes itself in, then the content rising in one block
 * at a time (the title is block 0). `footer` pins to the bottom, above the home
 * indicator, and rises last.
 */
export function OnboardingFrame({
  steps,
  step,
  title,
  body,
  onBack,
  onSkip,
  footer,
  children,
}: {
  steps: readonly OnboardingStep[];
  step: OnboardingStep;
  title: string;
  body?: string;
  onBack: () => void;
  onSkip: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const { layout } = useAppTheme();
  const insets = useSafeAreaInsets();
  // Its own wash scope: the root's snapshot cannot see a native-stack screen's contents
  // (it comes back black), so the Pick a look step washes within its own view.
  return (
    <ThemeWashScope style={layout.screen}>
      <OnboardingHeader onBack={onBack} onSkip={onSkip} thread={<OnboardingThread steps={steps} current={step} />} />
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
    </ThemeWashScope>
  );
}
