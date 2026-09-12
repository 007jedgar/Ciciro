import { Redirect, Tabs, useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { AppHeader } from "../../../components/AppHeader";
import { ManuscriptTabBar } from "../../../components/ManuscriptTabBar";
import { WritingMeter } from "../../../components/WritingMeter";
import { ProjectProvider, useProject } from "../../../lib/project";
import { useSession } from "../../../lib/session";
import { useAppTheme } from "../../../lib/settings";

function ProjectHeader() {
  const router = useRouter();
  const { t } = useTranslation();
  const { project } = useProject();
  return (
    <AppHeader
      title={project?.title || t("project.untitled")}
      onBack={() => router.dismissTo("/manuscripts")}
      backAccessibilityLabel={t("project.backToManuscripts")}
      onSettings={() => router.push("/settings")}
    />
  );
}

export default function ProjectTabsLayout() {
  const router = useRouter();
  const { t } = useTranslation();
  const { user, ready } = useSession();
  const { layout, colors } = useAppTheme();
  const { id } = useLocalSearchParams<{ id: string }>();

  if (!ready) {
    return (
      <View style={[layout.screen, { alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  if (!user) return <Redirect href="/login" />;
  if (!id || Array.isArray(id)) {
    return (
      <View style={layout.screen}>
        <AppHeader
          title={t("project.manuscript")}
          onBack={() => router.dismissTo("/manuscripts")}
          backAccessibilityLabel={t("project.backToManuscripts")}
        />
        <View style={layout.padded}>
          <Text style={layout.error}>{t("project.missingId")}</Text>
        </View>
      </View>
    );
  }

  return (
    <ProjectProvider projectId={id}>
      <View style={layout.screen}>
        <ProjectHeader />
        <WritingMeter />
        <View style={{ flex: 1 }}>
          <Tabs
            backBehavior="none"
            tabBar={() => null}
            screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg } }}
          >
            <Tabs.Screen name="chapters" options={{ title: t("project.chapters") }} />
            <Tabs.Screen name="manuscript" options={{ title: t("project.manuscript") }} />
            <Tabs.Screen name="ciciro" options={{ title: t("project.ciciro") }} />
            <Tabs.Screen name="index" options={{ href: null }} />
          </Tabs>
          <ManuscriptTabBar projectId={id} />
        </View>
      </View>
    </ProjectProvider>
  );
}
