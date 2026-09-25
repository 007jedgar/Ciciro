import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { AppHeader } from "../../../components/AppHeader";
import { ManuscriptSearch } from "../../../components/ManuscriptSearch";
import { useProject } from "../../../lib/project";
import type { SearchMatch } from "../../../lib/search";
import { useSession } from "../../../lib/session";
import { useAppTheme } from "../../../lib/settings";
import { useStackBack } from "../../../lib/use-stack-back";

export default function SearchScreen() {
  const router = useRouter();
  const { backOr } = useStackBack();
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, ready } = useSession();
  const { layout } = useAppTheme();
  const { setSelectedChapterId, recordReadingPosition } = useProject();
  const projectId = typeof id === "string" ? id : "";

  if (!ready) return null;
  if (!user) return <Redirect href="/login" />;
  if (!projectId) return <Redirect href="/manuscripts" />;

  function jump(match: SearchMatch) {
    setSelectedChapterId(match.chapterId);
    // The manuscript screen opens where the last reading position says.
    void recordReadingPosition({
      chapterId: match.chapterId,
      blockId: match.blockId,
      offset: match.offset,
    });
    router.navigate(`/project/${projectId}/manuscript`);
  }

  return (
    <View style={layout.screen}>
      <AppHeader
        title={t("search.title")}
        onBack={() => backOr(`/project/${projectId}/chapters`)}
        backAccessibilityLabel={t("search.back")}
      />
      <View style={[layout.padded, { flex: 1 }]}>
        <ManuscriptSearch projectId={projectId} onJump={jump} />
      </View>
    </View>
  );
}
