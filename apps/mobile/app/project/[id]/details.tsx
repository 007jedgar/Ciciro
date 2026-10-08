import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { Redirect, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { AppHeader, useAppHeaderHeight } from "../../../components/AppHeader";
import { ManuscriptDetails } from "../../../components/ManuscriptDetails";
import { ProjectLoadError } from "../../../components/ProjectLoadError";
import { ScreenErrorBoundary } from "../../../components/ScreenErrorBoundary";
import { SkeletonList } from "../../../components/Skeleton";
import { useProject } from "../../../lib/project";
import { useSession } from "../../../lib/session";
import { useAppTheme } from "../../../lib/settings";
import { useStackBack } from "../../../lib/use-stack-back";

export default function ManuscriptDetailsScreen() {
  return (
    <ScreenErrorBoundary>
      <ManuscriptDetailsScreenContent />
    </ScreenErrorBoundary>
  );
}

function ManuscriptDetailsScreenContent() {
  const { backOr, backTo } = useStackBack();
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, ready } = useSession();
  const { layout } = useAppTheme();
  const headerHeight = useAppHeaderHeight();
  const { project, loading, error, errorDetail, reload } = useProject();
  const projectId = typeof id === "string" ? id : "";

  if (!ready) return null;
  if (!user) return <Redirect href="/login" />;
  if (!projectId) return <Redirect href="/manuscripts" />;

  return (
    <KeyboardAvoidingView
      style={layout.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <AppHeader
        title={t("details.title")}
        onBack={() => backOr(`/project/${projectId}/chapters`)}
        backAccessibilityLabel={t("details.back")}
        floating
      />
      {error && !project ? (
        <ProjectLoadError message={error} detail={errorDetail} reload={reload} />
      ) : (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: headerHeight + 16, paddingBottom: 48 }}
          scrollIndicatorInsets={{ top: headerHeight }}
        >
          {project ? (
            // Deleting leaves the manuscript's whole stack, not just this screen. A pop
            // back to the library (already mounted, its rows updated by the mutation)
            // rather than a RESET: a freshly mounted library lands with its rows collapsed.
            <ManuscriptDetails project={project} onDeleted={() => backTo("/manuscripts")} />
          ) : loading ? (
            <SkeletonList count={4} accessibilityLabel={t("common.loading")} />
          ) : (
            <View>
              <Text style={layout.body}>{t("project.loadError")}</Text>
            </View>
          )}
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}
