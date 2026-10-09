import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { announce } from "../../lib/announce";
import * as haptics from "../../lib/haptics";
import { useAppTheme } from "../../lib/settings";
import { fonts } from "../../lib/theme";
import { useExerciseClock } from "../../lib/use-exercise-clock";
import { useReduceMotion } from "../../lib/use-reduce-motion";
import { SETTLE_MS, settlePromptAt } from "../../lib/writing-exercise";
import { ProgressRing } from "../ProgressRing";
import { TapPressable } from "../TapPressable";
import { ExerciseTopBar } from "./ExerciseTopBar";

const PROMPT_FADE_MS = 500;
const SETTLE_RING = 64;

/**
 * Before any writing: the page stays shut for the settle-in while a prompt for
 * each sense (look, listen, smell, feel) holds the screen in turn. A ring fills
 * across the whole pause and it ends by opening the page, so it is a pause with
 * an end, not a wait with no end in sight.
 */
export function ExerciseSettle({
  label,
  onDone,
  onClose,
}: {
  label: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { colors, layout } = useAppTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const { progress, elapsedMs } = useExerciseClock(true, SETTLE_MS, () => {
    haptics.impact("light");
    onDone();
  });
  const prompt = settlePromptAt(elapsedMs);
  const text = t(`exercise.settle.${prompt}`);

  // VoiceOver hears each sense as it comes up, since a moving line of text is not announced on its own.
  useEffect(() => {
    announce(t("exercise.settle.a11y", { prompt: text }));
  }, [text, t]);

  return (
    <View style={{ flex: 1 }}>
      <ExerciseTopBar label={label} closeLabel={t("exercise.close")} onClose={onClose} />
      <View style={styles.center}>
        <Text style={[layout.cardMeta, styles.hint]}>{t("exercise.settle.hint")}</Text>
        <View style={styles.promptBox}>
          <Animated.Text
            key={prompt}
            entering={reduceMotion ? undefined : FadeIn.duration(PROMPT_FADE_MS)}
            exiting={reduceMotion ? undefined : FadeOut.duration(PROMPT_FADE_MS / 2)}
            accessibilityLabel={text}
            style={[styles.prompt, { color: colors.ink }]}
          >
            {text}
          </Animated.Text>
        </View>
        <ProgressRing progress={progress} size={SETTLE_RING} strokeWidth={3} color={colors.accent} trackColor={colors.line} />
      </View>
      <View style={{ alignItems: "center", paddingBottom: insets.bottom + 24 }}>
        <TapPressable
          feedback="dim"
          onPress={onDone}
          accessibilityRole="button"
          accessibilityLabel={t("exercise.settle.skip")}
          hitSlop={12}
          style={{ paddingVertical: 10, paddingHorizontal: 16 }}
        >
          <Text style={{ color: colors.inkSoft, fontSize: 14 }}>{t("exercise.settle.skip")}</Text>
        </TapPressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 40 },
  hint: { textAlign: "center", marginTop: 0 },
  promptBox: { minHeight: 120, justifyContent: "center" },
  prompt: { fontFamily: fonts.display, fontSize: 32, lineHeight: 40, textAlign: "center" },
});
