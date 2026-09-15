import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { OpenQuestion } from "../lib/api/types";
import { usePatchQuestionMutation, useQuestionsQuery } from "../lib/api";
import { useAppTheme } from "../lib/settings";
import { GlassSheet } from "./GlassSheet";
import { OpenQuestionCard } from "./OpenQuestionCard";

/**
 * The editor's open forks, in one place.
 *
 * Ciciro is told not to block on the author — when it hits a choice it cannot
 * make it writes something plausible, logs the fork, and carries on. This is
 * where those forks come back: answer one and the answer is handed to the
 * editor as a reconcile turn, which corrects the prose and the bible if the
 * guess was wrong, then closes the question itself.
 */
export function OpenQuestionsSheet({
  projectId,
  visible,
  onClose,
  onAnswer,
  chapterNumbers,
}: {
  projectId: string;
  visible: boolean;
  onClose: () => void;
  /** Send the author's answer to the editor. */
  onAnswer: (question: OpenQuestion, answer: string) => void;
  /** chapterId → its 1-based number, for "Chapter 3" labels. */
  chapterNumbers?: Map<string, number>;
}) {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const questions = useQuestionsQuery(projectId, undefined, { enabled: visible });
  const patch = usePatchQuestionMutation();
  const [showResolved, setShowResolved] = useState(false);

  const { open, resolved } = useMemo(() => {
    const rows = questions.data ?? [];
    return {
      open: rows.filter((row) => row.status === "open"),
      resolved: rows.filter((row) => row.status !== "open"),
    };
  }, [questions.data]);

  function chapterLabel(question: OpenQuestion): string | null {
    const number = question.chapterId ? chapterNumbers?.get(question.chapterId) : undefined;
    return number ? t("questions.chapter", { number }) : null;
  }

  function dismiss(question: OpenQuestion) {
    patch.mutate({ id: question.id, projectId, body: { status: "dismissed" } });
  }

  return (
    <GlassSheet
      visible={visible}
      onClose={onClose}
      title={t("questions.title")}
      snapPoints={[0.62, 0.92]}
      testID="open-questions-sheet"
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.blurb, { color: colors.inkSoft }]}>{t("questions.blurb")}</Text>

        {questions.isPending ? (
          <ActivityIndicator
            color={colors.accent}
            style={styles.spinner}
            accessibilityLabel={t("common.loading")}
          />
        ) : null}

        {questions.isError ? (
          <Text style={[styles.empty, { color: colors.danger }]}>{t("questions.loadError")}</Text>
        ) : null}

        {!questions.isPending && open.length === 0 ? (
          <Text style={[styles.empty, { color: colors.inkSoft }]}>{t("questions.empty")}</Text>
        ) : null}

        {open.map((question) => (
          <OpenQuestionCard
            key={question.id}
            question={question}
            colors={colors}
            chapterLabel={chapterLabel(question)}
            busy={patch.isPending}
            onAnswer={(answer) => {
              onAnswer(question, answer);
              onClose();
            }}
            onDismiss={() => dismiss(question)}
          />
        ))}

        {resolved.length > 0 ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: showResolved }}
              accessibilityLabel={t("questions.resolvedCount", { count: resolved.length })}
              onPress={() => setShowResolved((value) => !value)}
              style={styles.toggle}
              hitSlop={8}
            >
              <Text style={{ color: colors.accent, fontSize: 13 }}>
                {t("questions.resolvedCount", { count: resolved.length })}
              </Text>
            </Pressable>
            {showResolved
              ? resolved.map((question) => (
                  <View
                    key={question.id}
                    style={[styles.resolved, { borderColor: colors.line }]}
                  >
                    <Text style={[styles.resolvedQuestion, { color: colors.inkSoft }]}>
                      {question.question}
                    </Text>
                    {question.answer.trim() ? (
                      <Text style={[styles.resolvedLine, { color: colors.draft }]}>
                        {t("questions.answered", { answer: question.answer.trim() })}
                      </Text>
                    ) : null}
                    {question.resolution.trim() ? (
                      <Text style={[styles.resolvedLine, { color: colors.inkSoft }]}>
                        {question.resolution.trim()}
                      </Text>
                    ) : null}
                  </View>
                ))
              : null}
          </>
        ) : null}
      </ScrollView>
    </GlassSheet>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingBottom: 8 },
  blurb: { fontSize: 13, lineHeight: 19, marginBottom: 14 },
  spinner: { marginVertical: 24 },
  empty: { fontSize: 14, lineHeight: 21, marginVertical: 12 },
  toggle: { alignSelf: "flex-start", marginTop: 4, marginBottom: 8 },
  resolved: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
  },
  resolvedQuestion: { fontSize: 13.5, lineHeight: 19 },
  resolvedLine: { fontSize: 12.5, lineHeight: 18, marginTop: 4 },
});
