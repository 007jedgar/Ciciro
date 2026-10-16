import { useCallback, useRef, useState, type ReactNode } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown, type AnimatedStyle } from "react-native-reanimated";
import { WriteInTitle } from "./WriteInTitle";
import { alpha } from "../Glass";
import { fadeUpDelay } from "../../lib/skeleton";
import { useOnboardingChrome } from "../../lib/onboarding-shell";
import { useAppTheme } from "../../lib/settings";
import { useReduceMotion } from "../../lib/use-reduce-motion";
import type { OnboardingStep } from "../../lib/onboarding-flow";

const RISE_MS = 260;
/** How far the list fades out above a pinned footer, so a row cut at its edge reads as scrolling under it. */
const FOOTER_FADE = 28;
/** Slack, in points, before the list counts as scrolled to its end. */
const END_SLACK = 4;

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
 * pins to the bottom, above the home indicator, and rises last. While more of
 * the list is still below the footer, a hairline sets the footer apart and the
 * list fades out above it, so on a short screen a row cut off at the footer does
 * not run into the footer's own text. The header
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
  const { colors, layout } = useAppTheme();
  const insets = useSafeAreaInsets();
  useOnboardingChrome({ step, steps, onBack, onSkip });
  const [moreBelow, setMoreBelow] = useState(false);
  const metrics = useRef({ viewport: 0, content: 0, offset: 0 });
  const measure = useCallback(() => {
    const { viewport, content, offset } = metrics.current;
    const below = viewport > 0 && content - viewport - offset > END_SLACK;
    setMoreBelow((was) => (was === below ? was : below));
  }, []);
  return (
    <Animated.View style={[{ flex: 1 }, leave]}>
      <View style={{ flex: 1 }}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          onLayout={(e: LayoutChangeEvent) => {
            metrics.current.viewport = e.nativeEvent.layout.height;
            measure();
          }}
          onContentSizeChange={(_w: number, h: number) => {
            metrics.current.content = h;
            measure();
          }}
          onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
            metrics.current.offset = e.nativeEvent.contentOffset.y;
            measure();
          }}
          scrollEventThrottle={32}
        >
          <WriteInTitle text={title} style={[layout.title, { marginBottom: body ? 8 : 20 }]} />
          {body ? (
            <Rise index={1}>
              <Text style={[layout.body, { marginBottom: 20 }]}>{body}</Text>
            </Rise>
          ) : null}
          {children}
        </ScrollView>
        {footer && moreBelow ? (
          <LinearGradient
            pointerEvents="none"
            colors={[alpha(colors.bg, 0), colors.bg]}
            style={styles.fade}
          />
        ) : null}
      </View>
      {footer ? (
        <Rise
          index={6}
          style={{
            paddingHorizontal: 20,
            paddingBottom: insets.bottom + 20,
            paddingTop: 12,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: moreBelow ? colors.line : "transparent",
          }}
        >
          {footer}
        </Rise>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fade: { position: "absolute", left: 0, right: 0, bottom: 0, height: FOOTER_FADE },
});
