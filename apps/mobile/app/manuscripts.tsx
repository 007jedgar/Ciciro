import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { Redirect, Stack, useRouter } from "expo-router";
import { ApiError } from "../lib/api";
import { listManuscripts } from "../lib/manuscripts";
import { useAppTheme } from "../lib/settings";
import { useSession } from "../lib/session";
import type { ProjectListItem } from "../lib/types";

export default function ManuscriptsScreen() {
  const router = useRouter();
  const { user, ready, logout } = useSession();
  const { layout, colors } = useAppTheme();
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
    <View style={layout.padded}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Pressable
                onPress={() => router.push("/settings")}
                accessibilityRole="button"
                accessibilityLabel="Settings"
                style={{ paddingHorizontal: 8, paddingVertical: 4 }}
              >
                <Text style={layout.ghostBtnText}>Settings</Text>
              </Pressable>
              <Pressable
                onPress={() => router.push("/new-manuscript")}
                accessibilityRole="button"
                accessibilityLabel="New manuscript"
                style={{ paddingHorizontal: 8, paddingVertical: 4 }}
              >
                <Text style={layout.ghostBtnText}>New</Text>
              </Pressable>
            </View>
          ),
        }}
      />
      <Text style={layout.body}>
        Signed in as {user.email}. One editor - Ciciro - lives on the hosted app.
      </Text>
      <Pressable style={layout.ghostBtn} onPress={() => void logout().then(() => router.replace("/"))}>
        <Text style={layout.ghostBtnText}>Sign out</Text>
      </Pressable>
      {error ? (
        <Text style={layout.error} role="alert">
          {error}
        </Text>
      ) : null}
      {projects === null && !error ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={projects ?? []}
          keyExtractor={(item) => item.id}
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
          ListHeaderComponent={
            <Pressable
              style={[layout.primaryBtn, { marginTop: 8, marginBottom: 16 }]}
              onPress={() => router.push("/new-manuscript")}
              accessibilityRole="button"
              accessibilityLabel="Start a new manuscript"
            >
              <Text style={layout.primaryBtnText}>Start a new manuscript</Text>
            </Pressable>
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
