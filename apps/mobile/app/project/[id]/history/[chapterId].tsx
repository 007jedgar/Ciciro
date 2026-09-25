import { Redirect, useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { AppHeader } from "../../../../components/AppHeader";
import { ChapterHistory } from "../../../../components/ChapterHistory";
import { SkeletonList } from "../../../../components/Skeleton";
import { chapterNumberLabel, customChapterTitle } from "../../../../lib/chapter-label";
import { useProject } from "../../../../lib/project";
import { useSession } from "../../../../lib/session";
import { useAppTheme } from "../../../../lib/settings";
import { useStackBack } from "../../../../lib/use-stack-back";

export default function ChapterHistoryScreen() {
  const { backOr } = useStackBack();
  const { t } = useTranslation();
  const { id, chapterId } = useLocalSearchParams<{ id: string; chapterId: string }>();
  const { user, ready } = useSession();
  const { layout } = useAppTheme();
  const { project, loading, syncChapters } = useProject();
  const projectId = typeof id === "string" ? id : "";
  const targetId = typeof chapterId === "string" ? chapterId : "";

  if (!ready) return null;
  if (!user) return <Redirect href="/login" />;
  if (!projectId) return <Redirect href="/manuscripts" />;

  const index = project?.chapters.findIndex((c) => c.id === targetId) ?? -1;
  const chapter = index >= 0 ? project?.chapters[index] : undefined;
  const numbered = chapterNumberLabel(index + 1, (key, opts) => t(key, opts));
  const custom = chapter ? customChapterTitle(chapter.title, numbered, t("chapters.newTitle")) : null;

  return (
    <View style={layout.screen}>
      <AppHeader
        title={t("history.title")}
        onBack={() => backOr(`/project/${projectId}/chapters`)}
        backAccessibilityLabel={t("history.backToChapters")}
      />
      {chapter ? (
        <ChapterHistory
          chapterId={chapter.id}
          heading={custom ? `${numbered} · ${custom}` : numbered}
          currentContent={chapter.content}
          settle={syncChapters}
        />
      ) : loading ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
          <SkeletonList count={4} accessibilityLabel={t("common.loading")} />
        </View>
      ) : (
        <View style={layout.padded}>
          <Text style={layout.error}>{t("history.loadError")}</Text>
        </View>
      )}
    </View>
  );
}
