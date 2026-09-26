import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { AppHeader } from "../../../components/AppHeader";
import { ReaderComments } from "../../../components/ReaderComments";
import type { ShareComment } from "../../../lib/api/types";
import { useProject } from "../../../lib/project";
import { useSession } from "../../../lib/session";
import { useAppTheme } from "../../../lib/settings";
import { shareLinksHref } from "../../../lib/shares";
import { useStackBack } from "../../../lib/use-stack-back";

export default function BetaReadersScreen() {
  const router = useRouter();
  const { backOr } = useStackBack();
  const { t } = useTranslation();
  const { id, chapterId } = useLocalSearchParams<{ id: string; chapterId?: string }>();
  const { user, ready } = useSession();
  const { layout } = useAppTheme();
  const { project, setSelectedChapterId, recordReadingPosition } = useProject();
  const projectId = typeof id === "string" ? id : "";

  if (!ready) return null;
  if (!user) return <Redirect href="/login" />;
  if (!projectId) return <Redirect href="/manuscripts" />;

  function jump(comment: ShareComment) {
    if (!comment.anchor) return;
    setSelectedChapterId(comment.chapterId);
    // The manuscript screen opens where the last reading position says.
    void recordReadingPosition({
      chapterId: comment.chapterId,
      blockId: comment.anchor.blockId,
      offset: comment.anchor.offset,
    });
    router.navigate(`/project/${projectId}/manuscript`);
  }

  return (
    <View style={layout.screen}>
      <AppHeader
        title={t("beta.title")}
        onBack={() => backOr(`/project/${projectId}/chapters`)}
        backAccessibilityLabel={t("beta.backToManuscript")}
      />
      <ReaderComments
        projectId={projectId}
        chapters={project?.chapters ?? []}
        chapterId={typeof chapterId === "string" && chapterId ? chapterId : undefined}
        onJump={jump}
        onManageLinks={() => router.push(shareLinksHref(projectId) as never)}
      />
    </View>
  );
}
