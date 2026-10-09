import { useEffect, useRef } from "react";
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { KeyboardAvoidingView, useKeyboardState } from "react-native-keyboard-controller";
import type { EnrichedTextInputInstance } from "react-native-enriched-html";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { announce } from "../../lib/announce";
import * as haptics from "../../lib/haptics";
import { useAppTheme } from "../../lib/settings";
import { fonts } from "../../lib/theme";
import { useExerciseClock } from "../../lib/use-exercise-clock";
import { PART_MS, type ExercisePart } from "../../lib/writing-exercise";
import { ChapterEditor } from "../ChapterEditor";
import { PressableCard } from "../PressableCard";
import { ProgressRing } from "../ProgressRing";
import { ExerciseTopBar } from "./ExerciseTopBar";

const CLOCK_RING = 26;
/** Share of the window the text from earlier parts may take, less while the keyboard is up. */
const EARLIER_SHARE = 0.26;
const EARLIER_SHARE_TYPING = 0.16;

export type EarlierText = { part: ExercisePart; label: string; text: string };

/**
 * One writing part, on focus mode's calm surface: a quiet guide line, the text
 * from earlier parts folded small above the page (read only, scrollable), and
 * the real editor taking the rest. The part's soft clock is a ring in the top
 * bar that closes after `PART_MINUTES`; when it does the page says so gently
 * and Next warms to the accent, but nothing locks: they can write on or move on.
 */
export function ExercisePage({
  part,
  label,
  earlier,
  nextLabel,
  onChangeText,
  onNext,
  onClose,
}: {
  part: ExercisePart;
  /** The top bar's label: the part and where it sits in the three. */
  label: string;
  earlier: EarlierText[];
  nextLabel: string;
  onChangeText: (text: string) => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { colors, layout, settings } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const keyboardVisible = useKeyboardState((state) => state.isVisible);
  const editorRef = useRef<EnrichedTextInputInstance | null>(null);

  const { progress, elapsedMs, done } = useExerciseClock(true, PART_MS, () => {
    haptics.impact("light");
    announce(t("exercise.timeUpA11y"));
  });
  const minutesLeft = Math.max(1, Math.ceil((PART_MS - elapsedMs) / 60_000));

  const editorStyle = {
    fontFamily: settings.editorFont === "sans" ? fonts.sans : fonts.serif,
    fontSize: settings.editorFontSize,
    lineHeight: Math.round(settings.editorFontSize * 1.55),
    color: colors.ink,
  };

  // Works with any keyboard: tapping the guide and the Next bar's own button both end up here.
  function dismissKeyboard() {
    editorRef.current?.blur();
    Keyboard.dismiss();
  }

  useEffect(() => {
    announce(`${t(`exercise.parts.${part}.name`)}. ${t(`exercise.parts.${part}.guide`)}`);
  }, [part, t]);

  const ring = (
    <View
      accessible
      accessibilityRole="timer"
      accessibilityLabel={done ? t("exercise.timeUpA11y") : t("exercise.timerA11y", { count: minutesLeft })}
    >
      <ProgressRing progress={progress} size={CLOCK_RING} strokeWidth={3} color={colors.accent} trackColor={colors.line} />
    </View>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" automaticOffset>
      <ExerciseTopBar label={label} ring={ring} closeLabel={t("exercise.close")} onClose={onClose} />
      <Pressable onPress={dismissKeyboard} accessible={false} style={styles.guideBox}>
        <Text style={[styles.guide, { color: colors.ink }]} accessibilityRole="header">
          {t(`exercise.parts.${part}.guide`)}
        </Text>
        {done ? <Text style={[layout.cardMeta, { marginTop: 8 }]}>{t("exercise.timeUp")}</Text> : null}
      </Pressable>

      {earlier.length > 0 ? (
        <ScrollView
          nestedScrollEnabled
          style={[
            styles.earlier,
            {
              maxHeight: windowHeight * (keyboardVisible ? EARLIER_SHARE_TYPING : EARLIER_SHARE),
              borderColor: colors.line,
              backgroundColor: colors.panel,
            },
          ]}
          contentContainerStyle={{ padding: 14, gap: 12 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {earlier.map((item) => (
            <View key={item.part} accessible accessibilityLabel={`${item.label}. ${item.text}`}>
              <Text style={[styles.earlierLabel, { color: colors.inkSoft }]}>{item.label.toUpperCase()}</Text>
              <Text style={{ color: colors.inkSoft, fontFamily: editorStyle.fontFamily, fontSize: 15, lineHeight: 22 }}>
                {item.text.trim()}
              </Text>
            </View>
          ))}
        </ScrollView>
      ) : null}

      <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 8 }}>
        <ChapterEditor
          chapterId={`exercise-${part}`}
          html=""
          editorStyle={editorStyle}
          placeholder={t(`exercise.parts.${part}.placeholder`)}
          resumeOffset={0}
          typewriter
          onFocused={() => {}}
          onBlurred={() => {}}
          onChangeText={onChangeText}
          onChangeState={() => {}}
          onChangeSelection={() => {}}
          registerEditor={(ref) => {
            editorRef.current = ref;
          }}
          testID="exercise-editor"
        />
      </View>

      <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: keyboardVisible ? 8 : insets.bottom + 16 }}>
        <PressableCard
          accent={done}
          onPress={() => {
            dismissKeyboard();
            onNext();
          }}
          accessibilityRole="button"
          accessibilityLabel={nextLabel}
          style={[
            layout.primaryBtn,
            { marginTop: 0 },
            done ? null : { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line },
          ]}
        >
          <Text style={[layout.primaryBtnText, done ? null : { color: colors.ink }]}>{nextLabel}</Text>
        </PressableCard>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  guideBox: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 6 },
  guide: { fontFamily: fonts.displayRegular, fontSize: 22, lineHeight: 30 },
  earlier: { marginHorizontal: 20, marginTop: 10, borderWidth: 1, borderRadius: 10, flexGrow: 0 },
  earlierLabel: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.2, marginBottom: 4 },
});
