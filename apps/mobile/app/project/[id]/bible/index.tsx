import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useStackBack } from "../../../../lib/use-stack-back";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { AppHeader } from "../../../../components/AppHeader";
import { StoryBibleIndex } from "../../../../components/StoryBibleIndex";
import { bibleFileHref } from "../../../../lib/bible-files";
import { useAppTheme } from "../../../../lib/settings";
import { useSession } from "../../../../lib/session";

export default function StoryBibleIndexScreen() {
  const router = useRouter();
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
        title={t("bible.title")}
        onBack={() => backOr(`/project/${projectId}/chapters`)}
        backAccessibilityLabel={t("bible.backToManuscript")}
      />
      <StoryBibleIndex
        projectId={projectId}
        onOpenFile={(path) => router.push(bibleFileHref(projectId, path) as never)}
      />
    </View>
  );
}
