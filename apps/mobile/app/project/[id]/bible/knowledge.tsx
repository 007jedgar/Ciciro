import { Redirect, useLocalSearchParams } from "expo-router";
import { useStackBack } from "../../../../lib/use-stack-back";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { AppHeader } from "../../../../components/AppHeader";
import { KnowledgeBoard } from "../../../../components/KnowledgeBoard";
import { useAppTheme } from "../../../../lib/settings";
import { useSession } from "../../../../lib/session";

export default function KnowledgeScreen() {
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
        title={t("bible.knowledge.title")}
        onBack={() => backOr(`/project/${projectId}/bible`)}
      />
      <KnowledgeBoard projectId={projectId} />
    </View>
  );
}
