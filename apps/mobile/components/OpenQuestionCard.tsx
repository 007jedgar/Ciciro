import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import type { OpenQuestion } from "../lib/api/types";
import type { ColorTokens } from "../lib/theme";

/**
 * One fork the editor took without stopping to ask. The author answers it here
 * and the answer goes back to the editor as a reconcile turn, so the manuscript
 * and bible get corrected rather than the note simply being ticked off.
 */
export function OpenQuestionCard({
  question,
  colors,
  chapterLabel,
  busy,
  onAnswer,
  onDismiss,
}: {
  question: OpenQuestion;
  colors: ColorTokens;
  /** "Chapter 3", when the question names one. */
  chapterLabel?: string | null;
  busy?: boolean;
  onAnswer: (answer: string) => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const [answer, setAnswer] = useState("");
  const ready = Boolean(answer.trim()) && !busy;

  const where = [question.affects.trim(), chapterLabel].filter(Boolean).join(" · ");

  return (
    <Animated.View
      entering={FadeIn.duration(220)}
      exiting={FadeOut.duration(160)}
      layout={LinearTransition.duration(200)}
      style={[styles.card, { borderColor: colors.line, backgroundColor: colors.panel }]}
    >
      <Text style={[styles.question, { color: colors.ink }]}>{question.question}</Text>

      {question.provisional.trim() ? (
        <Text style={[styles.meta, { color: colors.inkSoft }]}>
          {t("questions.wentWith", { provisional: question.provisional.trim() })}
        </Text>
      ) : null}
      {where ? <Text style={[styles.meta, { color: colors.inkSoft }]}>{where}</Text> : null}

      <TextInput
        accessibilityLabel={t("questions.answerLabel")}
        placeholder={t("questions.answerPlaceholder")}
        placeholderTextColor={colors.inkSoft}
        value={answer}
        onChangeText={setAnswer}
        multiline
        editable={!busy}
        style={[
          styles.field,
          { color: colors.ink, borderColor: colors.line, backgroundColor: colors.panel2 },
        ]}
      />

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !ready }}
          accessibilityLabel={t("questions.answer")}
          disabled={!ready}
          onPress={() => onAnswer(answer.trim())}
          style={({ pressed }) => [
            styles.primary,
            {
              backgroundColor: colors.accent,
              opacity: !ready ? 0.4 : pressed ? 0.82 : 1,
            },
          ]}
        >
          <Text style={[styles.primaryLabel, { color: colors.panel }]}>
            {t("questions.answer")}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("questions.dismiss")}
          disabled={busy}
          onPress={onDismiss}
          hitSlop={8}
        >
          <Text style={{ color: colors.inkSoft, fontSize: 13 }}>{t("questions.dismiss")}</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 12,
  },
  question: { fontSize: 15, lineHeight: 21, fontWeight: "600" },
  meta: { fontSize: 12.5, lineHeight: 18, marginTop: 5 },
  field: {
    marginTop: 10,
    minHeight: 60,
    maxHeight: 140,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    lineHeight: 21,
    textAlignVertical: "top",
  },
  actions: { flexDirection: "row", alignItems: "center", gap: 16, marginTop: 10 },
  primary: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999 },
  primaryLabel: { fontSize: 13, fontWeight: "600" },
});
