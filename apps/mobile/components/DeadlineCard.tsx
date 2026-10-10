import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { dueText, formatCount } from "../lib/deadline-text";
import { useDeadline } from "../lib/use-deadline";
import { useAppTheme } from "../lib/settings";
import { DeadlineRing } from "./DeadlineRing";
import { PressableCard } from "./PressableCard";

/**
 * The manuscript's deadline at a glance, at the head of its chapters: the ring,
 * when it is due, and how it is going. Nothing renders for a manuscript with no
 * deadline (the Deadline tool is where one is set).
 */
export function DeadlineCard({ projectId }: { projectId: string }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { layout } = useAppTheme();
  const { snapshot, loaded } = useDeadline(projectId);
  if (!snapshot || !loaded) return null;

  const complete = snapshot.status === "complete";
  const headline = complete ? t("deadline.status.complete") : dueText(t, snapshot);
  const status = t(`deadline.status.${snapshot.status}`);
  const progress = t("deadline.progress", {
    written: formatCount(snapshot.manuscriptWords, i18n.language),
    goal: formatCount(snapshot.wordGoal, i18n.language),
  });

  return (
    <PressableCard
      testID="deadline-card"
      style={[layout.card, styles.card]}
      onPress={() => router.push(`/project/${projectId}/deadline` as never)}
      accessibilityRole="button"
      accessibilityLabel={[t("deadline.title"), headline, complete ? null : status, progress].filter(Boolean).join(". ")}
    >
      <DeadlineRing progress={snapshot.progress} complete={complete} size={52} strokeWidth={4} />
      <View style={styles.text}>
        <Text style={layout.cardTitle}>{headline}</Text>
        <Text style={layout.cardMeta}>{complete ? progress : `${status} / ${progress}`}</Text>
      </View>
    </PressableCard>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 16 },
  text: { flex: 1 },
});
