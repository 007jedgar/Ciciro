import { useEffect } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useStuckPromptsMutation } from "../lib/api";
import { stuckPromptHref } from "../lib/recap";
import { useAppTheme } from "../lib/settings";
import { FadeUp, LoadingBlock } from "./LoadingBlock";
import { GlassSheet } from "./GlassSheet";
import { TapPressable } from "./TapPressable";

/**
 * "I'm stuck" sheet, opened from the writing tools menu. Lists a few concrete
 * next steps drawn from this chapter and the story bible; picking one hands it
 * to Ciciro.
 */
export function StuckSheet({
  open,
  onClose,
  projectId,
  chapterId,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  chapterId: string;
}) {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const router = useRouter();
  const ask = useStuckPromptsMutation();
  const { mutate } = ask;

  useEffect(() => {
    if (open) mutate({ projectId, chapterId });
  }, [open, mutate, projectId, chapterId]);

  function use(prompt: string) {
    onClose();
    router.navigate(stuckPromptHref(projectId, prompt) as never);
  }

  return (
    <>
      <GlassSheet
        visible={open}
        onClose={onClose}
        title={t("stuck.title")}
        snapPoints={[0.55, 0.9]}
        testID="stuck-sheet"
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={[styles.blurb, { color: colors.inkSoft }]}>{t("stuck.blurb")}</Text>
          {ask.isPending ? (
            <LoadingBlock label={t("stuck.loading")} lines={4} />
          ) : ask.isError ? (
            <Text style={{ color: colors.danger }} role="alert">
              {t("stuck.error")}
            </Text>
          ) : (
            (ask.data ?? []).map((prompt, index) => (
              <FadeUp key={prompt} index={index}>
                <TapPressable
                  accessibilityRole="button"
                  onPress={() => use(prompt)}
                  style={({ pressed }) => [
                    styles.prompt,
                    { borderColor: colors.line, backgroundColor: colors.panel, opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <Text style={[styles.promptText, { color: colors.ink }]}>{prompt}</Text>
                </TapPressable>
              </FadeUp>
            ))
          )}
          <View style={styles.more}>
            <TapPressable
              accessibilityRole="button"
              disabled={ask.isPending}
              onPress={() => mutate({ projectId, chapterId })}
            >
              <Text style={{ color: colors.accent, fontWeight: "600", opacity: ask.isPending ? 0.5 : 1 }}>
                {t("stuck.more")}
              </Text>
            </TapPressable>
          </View>
        </ScrollView>
      </GlassSheet>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 10 },
  blurb: { fontSize: 14, lineHeight: 20 },
  prompt: { borderWidth: 1, borderRadius: 12, padding: 14 },
  promptText: { fontSize: 15, lineHeight: 21 },
  more: { alignItems: "flex-end", paddingTop: 4 },
});
