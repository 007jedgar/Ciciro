import { Redirect, useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { AppHeader } from "../../../components/AppHeader";
import { ReadAloud } from "../../../components/ReadAloud";
import { SkeletonList } from "../../../components/Skeleton";
import { readAloudSelectionFor } from "../../../lib/read-aloud";
import { blocksPlainText } from "../../../lib/read-aloud-text";
import { useProject } from "../../../lib/project";
import { useSession } from "../../../lib/session";
import { useAppTheme } from "../../../lib/settings";
import { useStackBack } from "../../../lib/use-stack-back";

function ListenBody() {
  const { t } = useTranslation();
  const { layout } = useAppTheme();
  const { project, loading, error, selectedChapterId } = useProject();
  const chapter = project?.chapters.find((c) => c.id === selectedChapterId) ?? project?.chapters[0];

  if (loading && !project) {
    return (
      <View style={[layout.padded, { paddingTop: 8 }]}>
        <SkeletonList count={5} accessibilityLabel={t("common.loading")} />
      </View>
    );
  }
  if (error) {
    return (
      <View style={[layout.padded, { paddingTop: 16 }]}>
        <Text style={layout.error}>{error}</Text>
      </View>
    );
  }
  if (!chapter) {
    return (
      <View style={[layout.padded, { paddingTop: 16 }]}>
        <Text style={layout.body}>{t("manuscript.noChapters")}</Text>
      </View>
    );
  }
  const selection = readAloudSelectionFor(chapter.id, blocksPlainText(chapter.content));
  return (
    <View style={[layout.padded, { paddingTop: 8, flex: 1 }]}>
      <Text style={[layout.cardTitle, { marginBottom: 8 }]}>{chapter.title}</Text>
      <ReadAloud
        chapterId={chapter.id}
        html={chapter.content}
        selection={selection}
      />
    </View>
  );
}

export default function ListenScreen() {
  const { backOr } = useStackBack();
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, ready } = useSession();
  const { layout } = useAppTheme();
  const projectId = typeof id === "string" ? id : "";

  if (!ready) return null;
  if (!user) return <Redirect href="/login" />;
  if (!projectId) return <Redirect href="/manuscripts" />;

  return (
    <View style={layout.screen}>
      <AppHeader
        title={t("readAloud.title")}
        onBack={() => backOr(`/project/${projectId}/manuscript`)}
        backAccessibilityLabel={t("bible.backToManuscript")}
      />
      <ListenBody />
    </View>
  );
}
