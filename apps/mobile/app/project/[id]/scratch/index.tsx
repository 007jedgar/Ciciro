import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { AppHeader } from "../../../../components/AppHeader";
import { ScratchNotes } from "../../../../components/ScratchNotes";
import { scratchNoteHref } from "../../../../lib/scratch";
import { useSession } from "../../../../lib/session";
import { useAppTheme } from "../../../../lib/settings";
import { useStackBack } from "../../../../lib/use-stack-back";

export default function ScratchpadScreen() {
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
        title={t("scratch.title")}
        onBack={() => backOr(`/project/${projectId}/chapters`)}
        backAccessibilityLabel={t("scratch.backToManuscript")}
      />
      <ScratchNotes
        projectId={projectId}
        onOpen={(noteId) => router.push(scratchNoteHref(projectId, noteId) as never)}
      />
    </View>
  );
}
