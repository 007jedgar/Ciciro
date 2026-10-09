import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Easing, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { announce } from "../../lib/announce";
import * as haptics from "../../lib/haptics";
import { useAppTheme } from "../../lib/settings";
import { fonts } from "../../lib/theme";
import { useReduceMotion } from "../../lib/use-reduce-motion";
import { EXERCISE_PARTS, paragraphs, totalWords, type ExerciseTexts } from "../../lib/writing-exercise";
import { AlertText } from "../AlertText";
import { DrawCheck, useDrawProgress } from "../DrawCheck";
import { InlineDots } from "../InlineDots";
import { PressableCard } from "../PressableCard";
import { ProgressRing } from "../ProgressRing";
import { TapPressable } from "../TapPressable";
import { ExerciseTopBar } from "./ExerciseTopBar";

const DONE_RING = 112;
/** The ring closes over this long, then the tick draws inside it. */
const RING_CLOSE_MS = 480;

/**
 * The calm end: a ring that closes and a tick that draws inside it, then the
 * three texts, kept on the page, and the two ways to take them away: as a new
 * manuscript, or copied out.
 */
export function ExerciseDone({
  texts,
  labels,
  busy,
  error,
  copied,
  onKeep,
  onCopy,
  onClose,
}: {
  texts: ExerciseTexts;
  labels: Record<(typeof EXERCISE_PARTS)[number], string>;
  busy: boolean;
  error: string | null;
  copied: boolean;
  onKeep: () => void;
  onCopy: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { colors, layout, settings } = useAppTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const ring = useSharedValue(reduceMotion ? 1 : 0);
  const [closed, setClosed] = useState(reduceMotion);
  const tick = useDrawProgress(closed, 0, { drawOnMount: true });

  useEffect(() => {
    announce(t("exercise.done.announce"));
    haptics.celebrate();
    if (reduceMotion) return;
    ring.value = withTiming(1, { duration: RING_CLOSE_MS, easing: Easing.out(Easing.cubic) });
    const timer = setTimeout(() => setClosed(true), RING_CLOSE_MS);
    return () => clearTimeout(timer);
    // Plays once, when the screen is reached.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const words = totalWords(texts);
  const bodyFont = settings.editorFont === "sans" ? fonts.sans : fonts.serif;

  return (
    <View style={{ flex: 1 }}>
      <ExerciseTopBar closeLabel={t("exercise.close")} onClose={onClose} />
      <View style={styles.hero}>
        <ProgressRing progress={ring} size={DONE_RING} strokeWidth={4} color={colors.accent} trackColor={colors.line}>
          <DrawCheck progress={tick} color={colors.accent} size={44} strokeWidth={2.2} />
        </ProgressRing>
        <Text style={[styles.title, { color: colors.ink }]} accessibilityRole="header">
          {t("exercise.done.title")}
        </Text>
        <Text style={[layout.body, { textAlign: "center" }]}>{t("exercise.done.words", { count: words })}</Text>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 16, gap: 18 }}
        showsVerticalScrollIndicator={false}
      >
        {EXERCISE_PARTS.map((part) => (
          <View key={part} accessible accessibilityLabel={`${labels[part]}. ${texts[part].trim()}`}>
            <Text style={[styles.partLabel, { color: colors.inkSoft }]}>{labels[part].toUpperCase()}</Text>
            {paragraphs(texts[part]).map((line, index) => (
              <Text
                key={index}
                style={{
                  color: colors.ink,
                  fontFamily: bodyFont,
                  fontSize: 16,
                  lineHeight: 24,
                  marginTop: index > 0 ? 8 : 0,
                }}
              >
                {line}
              </Text>
            ))}
          </View>
        ))}
      </ScrollView>

      <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: insets.bottom + 16 }}>
        {error ? <AlertText style={[layout.error, { marginTop: 0, marginBottom: 8 }]}>{error}</AlertText> : null}
        <PressableCard
          accent
          disabled={busy}
          onPress={onKeep}
          accessibilityRole="button"
          accessibilityLabel={busy ? t("exercise.done.keeping") : t("exercise.done.keep")}
          accessibilityState={{ busy, disabled: busy }}
          style={[layout.primaryBtn, { marginTop: 0 }]}
        >
          {busy ? <InlineDots color={colors.panel} active reduceMotion={reduceMotion} /> : <Text style={layout.primaryBtnText}>{t("exercise.done.keep")}</Text>}
        </PressableCard>
        <View style={styles.secondary}>
          <TapPressable
            feedback="dim"
            onPress={onCopy}
            accessibilityRole="button"
            accessibilityLabel={copied ? t("exercise.done.copied") : t("exercise.done.copy")}
            style={styles.link}
          >
            <Text style={{ color: colors.accent, fontSize: 16 }}>
              {copied ? t("exercise.done.copied") : t("exercise.done.copy")}
            </Text>
          </TapPressable>
          <TapPressable
            feedback="dim"
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t("exercise.done.finish")}
            style={styles.link}
          >
            <Text style={{ color: colors.inkSoft, fontSize: 16 }}>{t("exercise.done.finish")}</Text>
          </TapPressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: "center", gap: 10, paddingTop: 12, paddingBottom: 20, paddingHorizontal: 20 },
  title: { fontFamily: fonts.display, fontSize: 30, lineHeight: 36, marginTop: 12, textAlign: "center" },
  partLabel: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.2, marginBottom: 4 },
  secondary: { flexDirection: "row", justifyContent: "center", gap: 28, marginTop: 6 },
  link: { paddingVertical: 12, paddingHorizontal: 8 },
});
