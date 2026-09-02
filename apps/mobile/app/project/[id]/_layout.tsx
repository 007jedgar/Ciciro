import { Redirect, Tabs, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Text, View } from "react-native";
import { ProjectProvider } from "../../../lib/project";
import { useSession } from "../../../lib/session";
import { colors, layout } from "../../../lib/theme";

export default function ProjectTabsLayout() {
  const { user, ready } = useSession();
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
      <View style={layout.padded}>
        <Text style={layout.error}>Missing manuscript id.</Text>
      </View>
    );
  }

  return (
    <ProjectProvider projectId={id}>
      <Tabs
        screenOptions={{
          headerTintColor: colors.ink,
          headerStyle: { backgroundColor: colors.panel },
          headerShadowVisible: false,
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: colors.inkSoft,
          tabBarStyle: { backgroundColor: colors.panel, borderTopColor: colors.line },
        }}
      >
        <Tabs.Screen name="chapters" options={{ title: "Chapters" }} />
        <Tabs.Screen name="manuscript" options={{ title: "Manuscript" }} />
        <Tabs.Screen name="ciciro" options={{ title: "Ciciro" }} />
        <Tabs.Screen name="index" options={{ href: null }} />
      </Tabs>
    </ProjectProvider>
  );
}
