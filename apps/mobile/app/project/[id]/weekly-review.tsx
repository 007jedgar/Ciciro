import { Redirect, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { AppHeader } from "../../../components/AppHeader";
import { WeeklyReview } from "../../../components/WeeklyReview";
import { useSession } from "../../../lib/session";
import { useAppTheme } from "../../../lib/settings";
import { useStackBack } from "../../../lib/use-stack-back";

export default function WeeklyReviewScreen() {
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
        title={t("weekly.title")}
        onBack={() => backOr(`/project/${projectId}/chapters`)}
        backAccessibilityLabel={t("weekly.backToManuscript")}
      />
      <WeeklyReview projectId={projectId} />
    </View>
  );
}
