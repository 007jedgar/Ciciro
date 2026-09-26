import { Redirect, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { AppHeader } from "../../../components/AppHeader";
import { ShareLinks } from "../../../components/ShareLinks";
import { useProject } from "../../../lib/project";
import { useSession } from "../../../lib/session";
import { useAppTheme } from "../../../lib/settings";
import { betaReadersHref } from "../../../lib/shares";
import { useStackBack } from "../../../lib/use-stack-back";

export default function ShareLinksScreen() {
  const { backOr } = useStackBack();
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, ready } = useSession();
  const { layout } = useAppTheme();
  const { project } = useProject();
  const projectId = typeof id === "string" ? id : "";

  if (!ready) return null;
  if (!user) return <Redirect href="/login" />;
  if (!projectId) return <Redirect href="/manuscripts" />;

  return (
    <View style={layout.screen}>
      <AppHeader
        title={t("beta.links.title")}
        onBack={() => backOr(betaReadersHref(projectId) as never)}
        backAccessibilityLabel={t("beta.links.back")}
      />
      <ShareLinks
        projectId={projectId}
        projectTitle={project?.title ?? ""}
        chapters={project?.chapters ?? []}
      />
    </View>
  );
}
