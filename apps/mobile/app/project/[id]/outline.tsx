import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { AppHeader } from "../../../components/AppHeader";
import { OutlineList } from "../../../components/OutlineList";
import { SkeletonList } from "../../../components/Skeleton";
import { useReorderChaptersMutation } from "../../../lib/api";
import { useProject } from "../../../lib/project";
import { useSession } from "../../../lib/session";
import { useAppTheme } from "../../../lib/settings";
import { useStackBack } from "../../../lib/use-stack-back";

function OutlineBody({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { t } = useTranslation();
  const { layout } = useAppTheme();
  const { project, loading, error, setSelectedChapterId } = useProject();
  const reorder = useReorderChaptersMutation();

  if (loading && !project) {
    return (
      <View style={[layout.padded, { paddingTop: 8 }]}>
        <SkeletonList count={6} accessibilityLabel={t("common.loading")} />
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
  const chapters = project?.chapters ?? [];
  return (
    <View style={[layout.padded, { paddingTop: 0, flex: 1 }]}>
      {reorder.isError ? (
        <Text style={[layout.error, { marginTop: 8 }]} role="alert">
          {t("outline.reorderError")}
        </Text>
      ) : null}
      {chapters.length === 0 ? (
        <Text style={[layout.body, { marginTop: 16 }]}>{t("chapters.empty")}</Text>
      ) : (
        <OutlineList
          chapters={chapters}
          paddingTop={12}
          paddingBottom={32}
          onOpen={(chapter) => {
            setSelectedChapterId(chapter.id);
            router.navigate(`/project/${projectId}/manuscript`);
          }}
          onReorder={(chapterIds) => reorder.mutate({ projectId, chapterIds })}
        />
      )}
    </View>
  );
}

export default function OutlineScreen() {
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
        title={t("outline.title")}
        onBack={() => backOr(`/project/${projectId}/chapters`)}
        backAccessibilityLabel={t("bible.backToManuscript")}
      />
      <OutlineBody projectId={projectId} />
    </View>
  );
}
