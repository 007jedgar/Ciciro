import { Redirect, Tabs, useLocalSearchParams, useRouter, useSegments } from "expo-router";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { AppHeader } from "../../../../components/AppHeader";
import { ManuscriptTabBar } from "../../../../components/ManuscriptTabBar";
import { SkeletonList } from "../../../../components/Skeleton";
import { WritingMeter } from "../../../../components/WritingMeter";
import { useProject } from "../../../../lib/project";
import { useSession } from "../../../../lib/session";
import { useAppTheme } from "../../../../lib/settings";
import { useStackBack } from "../../../../lib/use-stack-back";

function ProjectHeader() {
  const router = useRouter();
  const { backTo } = useStackBack();
  const { t } = useTranslation();
  const { project } = useProject();
  return (
    <AppHeader
      title={project?.title || t("project.untitled")}
      // Pops to the list when it is underneath, and swaps to it when the app
      // was restored straight onto this manuscript and there is nothing under.
      onBack={() => backTo("/manuscripts")}
      backAccessibilityLabel={t("project.backToManuscripts")}
      onSettings={() => router.push("/settings")}
    />
  );
}

export default function ProjectTabsLayout() {
  const { backTo } = useStackBack();
  const { t } = useTranslation();
  const { user, ready } = useSession();
  const { layout, colors } = useAppTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const segments = useSegments();
  const onEditor = segments[segments.length - 1] === "manuscript";

  if (!ready) {
    return (
      <View style={[layout.screen, { paddingHorizontal: 20, paddingTop: 24 }]}>
        <SkeletonList count={5} accessibilityLabel={t("common.loading")} />
      </View>
    );
  }
  if (!user) return <Redirect href="/login" />;
  if (!id || Array.isArray(id)) {
    return (
      <View style={layout.screen}>
        <AppHeader
          title={t("project.manuscript")}
          onBack={() => backTo("/manuscripts")}
          backAccessibilityLabel={t("project.backToManuscripts")}
        />
        <View style={layout.padded}>
          <Text style={layout.error}>{t("project.missingId")}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={layout.screen}>
      <ProjectHeader />
      {onEditor ? <WritingMeter /> : null}
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
  );
}
