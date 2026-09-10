import { Redirect, Tabs, useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Text, View } from "react-native";
import { AppHeader } from "../../../components/AppHeader";
import { ChaptersIcon, CiciroTabIcon, ManuscriptIcon } from "../../../components/icons";
import { ProjectProvider, useProject } from "../../../lib/project";
import { useSession } from "../../../lib/session";
import { useAppTheme } from "../../../lib/settings";

function ProjectHeader() {
  const router = useRouter();
  const { project } = useProject();
  return (
    <AppHeader
      title={project?.title || "Untitled Manuscript"}
      onBack={() => router.dismissTo("/manuscripts")}
      backAccessibilityLabel="Back to manuscripts"
      onSettings={() => router.push("/settings")}
    />
  );
}

export default function ProjectTabsLayout() {
  const router = useRouter();
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
          title="Manuscript"
          onBack={() => router.dismissTo("/manuscripts")}
          backAccessibilityLabel="Back to manuscripts"
        />
        <View style={layout.padded}>
          <Text style={layout.error}>Missing manuscript id.</Text>
        </View>
      </View>
    );
  }

  return (
    <ProjectProvider projectId={id}>
      <View style={layout.screen}>
        <ProjectHeader />
        <View style={{ flex: 1 }}>
          <Tabs
            backBehavior="none"
            screenOptions={{
              headerShown: false,
              tabBarActiveTintColor: colors.accent,
              tabBarInactiveTintColor: colors.inkSoft,
              tabBarHideOnKeyboard: true,
              tabBarLabelStyle: { fontSize: 11, fontWeight: "500" },
              tabBarStyle: { backgroundColor: colors.panel, borderTopColor: colors.line },
            }}
          >
            <Tabs.Screen
              name="chapters"
              options={{
                title: "Chapters",
                tabBarIcon: ({ color, size, focused }) => (
                  <ChaptersIcon color={color} size={size} focused={focused} />
                ),
              }}
            />
            <Tabs.Screen
              name="manuscript"
              options={{
                title: "Manuscript",
                tabBarIcon: ({ color, size, focused }) => (
                  <ManuscriptIcon color={color} size={size} focused={focused} />
                ),
              }}
            />
            <Tabs.Screen
              name="ciciro"
              options={{
                title: "Ciciro",
                tabBarIcon: ({ color, size, focused }) => (
                  <CiciroTabIcon color={color} size={size} focused={focused} />
                ),
              }}
            />
            <Tabs.Screen name="index" options={{ href: null }} />
          </Tabs>
        </View>
      </View>
    </ProjectProvider>
  );
}
