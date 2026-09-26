import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useStuckPromptsMutation } from "../lib/api";
import { stuckPromptHref } from "../lib/recap";
import { useAppTheme } from "../lib/settings";
import { GlassSheet } from "./GlassSheet";

/**
 * "I'm stuck" above the editor. Opens a sheet with a few concrete next steps
 * drawn from this chapter and the story bible; picking one hands it to Ciciro.
 */
export function StuckPill({ projectId, chapterId }: { projectId: string; chapterId: string }) {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ask = useStuckPromptsMutation();
  const { mutate } = ask;

  useEffect(() => {
    if (open) mutate({ projectId, chapterId });
  }, [open, mutate, projectId, chapterId]);

  function use(prompt: string) {
    setOpen(false);
    router.navigate(stuckPromptHref(projectId, prompt) as never);
  }

  return (
    <>
      <Pressable
        testID="stuck-pill"
        accessibilityRole="button"
        accessibilityLabel={t("stuck.pill")}
        accessibilityHint={t("stuck.hint")}
        onPress={() => setOpen(true)}
        hitSlop={6}
        style={({ pressed }) => [
          styles.pill,
          { borderColor: colors.line, backgroundColor: colors.panel, opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <Text style={[styles.pillText, { color: colors.accent }]}>{t("stuck.pill")}</Text>
      </Pressable>
      <GlassSheet
        visible={open}
        onClose={() => setOpen(false)}
        title={t("stuck.title")}
        snapPoints={[0.55, 0.9]}
        testID="stuck-sheet"
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={[styles.blurb, { color: colors.inkSoft }]}>{t("stuck.blurb")}</Text>
          {ask.isPending ? (
            <ActivityIndicator accessibilityLabel={t("common.loading")} />
          ) : ask.isError ? (
            <Text style={{ color: colors.danger }} role="alert">
              {t("stuck.error")}
            </Text>
          ) : (
            (ask.data ?? []).map((prompt) => (
              <Pressable
                key={prompt}
                accessibilityRole="button"
                onPress={() => use(prompt)}
                style={({ pressed }) => [
                  styles.prompt,
                  { borderColor: colors.line, backgroundColor: colors.panel, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Text style={[styles.promptText, { color: colors.ink }]}>{prompt}</Text>
              </Pressable>
            ))
          )}
          <View style={styles.more}>
            <Pressable
              accessibilityRole="button"
              disabled={ask.isPending}
              onPress={() => mutate({ projectId, chapterId })}
            >
              <Text style={{ color: colors.accent, fontWeight: "600", opacity: ask.isPending ? 0.5 : 1 }}>
                {t("stuck.more")}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </GlassSheet>
    </>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: "flex-end",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginBottom: 6,
  },
  pillText: { fontSize: 13, fontWeight: "600" },
  content: { padding: 20, gap: 10 },
  blurb: { fontSize: 14, lineHeight: 20 },
  prompt: { borderWidth: 1, borderRadius: 12, padding: 14 },
  promptText: { fontSize: 15, lineHeight: 21 },
  more: { alignItems: "flex-end", paddingTop: 4 },
});
