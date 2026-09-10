import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError } from "../lib/api";
import { listManuscripts } from "../lib/manuscripts";
import { ManuscriptsHeader } from "../components/ManuscriptsHeader";
import { useAppTheme } from "../lib/settings";
import { useSession } from "../lib/session";
import type { ProjectListItem } from "../lib/types";

export default function ManuscriptsScreen() {
  const router = useRouter();
  const { user, ready } = useSession();
  const { layout, colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [projects, setProjects] = useState<ProjectListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await listManuscripts();
      setProjects(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load manuscripts.");
    }
  }, []);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  if (!ready) {
    return (
      <View style={[layout.screen, { alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!user) return <Redirect href="/login" />;

  return (
    <View style={[layout.screen, { paddingBottom: 0 }]}>
      <ManuscriptsHeader
        colors={colors}
        topInset={insets.top}
        onSettings={() => router.push("/settings")}
        onNew={() => router.push("/new-manuscript")}
      />
      {error ? (
        <Text style={[layout.error, { marginHorizontal: 20, marginTop: 12 }]} role="alert">
          {error}
        </Text>
      ) : null}
      <Pressable
        style={[layout.primaryBtn, { marginHorizontal: 20, marginBottom: 12 }]}
        onPress={() => router.push("/new-manuscript")}
        accessibilityRole="button"
        accessibilityLabel="Start a new manuscript"
      >
        <Text style={layout.primaryBtnText}>Start a new manuscript</Text>
      </Pressable>
      {projects === null && !error ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          scrollEnabled={true}
          data={projects ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 20 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await load();
                setRefreshing(false);
              }}
              tintColor={colors.accent}
            />
          }
          ListEmptyComponent={
            <Text style={[layout.body, { marginTop: 8 }]}>
              No manuscripts yet. Create one here - you do not need the web app for that.
            </Text>
          }
          renderItem={({ item }) => (
            <Pressable
              style={layout.card}
              onPress={() => router.push(`/project/${item.id}/chapters`)}
            >
              <Text style={layout.cardTitle}>{item.title || "Untitled Manuscript"}</Text>
              <Text style={layout.cardMeta}>
                {[item.genre, item._count ? `${item._count.chapters} chapters` : null]
                  .filter(Boolean)
                  .join(" · ") || "Manuscript"}
              </Text>
              {item.logline ? <Text style={layout.cardMeta}>{item.logline}</Text> : null}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
