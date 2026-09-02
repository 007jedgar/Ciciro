import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { Redirect, useRouter } from "expo-router";
import { api, ApiError } from "../lib/api";
import { useSession } from "../lib/session";
import { colors, layout } from "../lib/theme";
import type { ProjectListItem } from "../lib/types";

export default function ManuscriptsScreen() {
  const router = useRouter();
  const { user, ready, logout } = useSession();
  const [projects, setProjects] = useState<ProjectListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api<ProjectListItem[]>("/api/projects");
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
          ListEmptyComponent={
            <Text style={[layout.body, { marginTop: 24 }]}>
              No manuscripts yet. Create one on the hosted web app, then pull to refresh.
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
