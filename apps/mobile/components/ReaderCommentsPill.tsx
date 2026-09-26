import { Pressable, StyleSheet, Text } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useShareCommentsQuery } from "../lib/api";
import { betaReadersHref } from "../lib/shares";
import { useAppTheme } from "../lib/settings";

/** "2 reader comments" over a chapter that has open ones; opens them. */
export function ReaderCommentsPill({ projectId, chapterId }: { projectId: string; chapterId: string }) {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const open = useShareCommentsQuery(projectId, "open");
  const count = (open.data ?? []).filter((c) => c.chapterId === chapterId).length;
  if (count === 0) return null;
  const label = t("beta.chapterComments", { count });
  return (
    <Pressable
      testID="reader-comments-pill"
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={t("beta.pillHint")}
      onPress={() => router.push(betaReadersHref(projectId, chapterId) as never)}
      hitSlop={6}
      style={({ pressed }) => [
        styles.pill,
        { backgroundColor: colors.accentSoft, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Text style={[styles.text, { color: colors.accent }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: "flex-end",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginBottom: 6,
  },
  text: { fontSize: 13, fontWeight: "600" },
});
