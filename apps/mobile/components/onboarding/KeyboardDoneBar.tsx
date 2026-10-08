import { Text } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { PressableCard } from "../PressableCard";
import { FOCUS_TRANSITION_MS } from "../../lib/focus-mode";
import { useAppTheme } from "../../lib/settings";
import { useReduceMotion } from "../../lib/use-reduce-motion";

/**
 * A "Done" button that sits just above the keyboard on the onboarding demos, so
 * the way back to Continue never depends on the keyboard having a dismiss key of
 * its own (a hardware keyboard, a third-party one, a split iPad keyboard).
 */
export function KeyboardDoneBar({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const reduceMotion = useReduceMotion();
  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeIn.duration(FOCUS_TRANSITION_MS)}
      exiting={reduceMotion ? undefined : FadeOut.duration(FOCUS_TRANSITION_MS)}
      style={{ paddingHorizontal: 20, paddingVertical: 8, alignItems: "flex-end" }}
    >
      <PressableCard
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={t("onboarding.demo.focus.hideKeyboard")}
        style={{
          borderWidth: 1,
          borderColor: colors.line,
          backgroundColor: colors.panel,
          borderRadius: 999,
          paddingVertical: 8,
          paddingHorizontal: 18,
        }}
      >
        <Text style={{ color: colors.accent, fontWeight: "600", fontSize: 15 }}>
          {t("onboarding.demo.focus.doneTyping")}
        </Text>
      </PressableCard>
    </Animated.View>
  );
}
