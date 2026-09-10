import { useMemo } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError, useFoldersQuery, useProjectsQuery } from "../lib/api";
import { AppHeader } from "../components/AppHeader";
import { useAppTheme } from "../lib/settings";
import { useSession } from "../lib/session";
import type { Folder, ProjectListItem } from "../lib/types";

type Row =
  | { key: string; kind: "folder"; folder: Folder }
  | { key: string; kind: "heading"; title: string }
  | { key: string; kind: "project"; project: ProjectListItem };

function queryErrorMessage(error: unknown, fallback: string): string | null {
  if (!error) return null;
  return error instanceof ApiError ? error.message : fallback;
}

export default function ManuscriptsScreen() {
  const router = useRouter();
  const { user, ready } = useSession();
  const { layout, colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const enabled = Boolean(user);
  const projectsQuery = useProjectsQuery({ enabled });
  const foldersQuery = useFoldersQuery({ enabled });
  const projects = projectsQuery.data ?? [];
  const folders = foldersQuery.data ?? [];
  const error =
    queryErrorMessage(projectsQuery.error, "Could not load manuscripts.") ??
    queryErrorMessage(foldersQuery.error, "Could not load folders.");

  const rows = useMemo<Row[]>(() => {
    const items: Row[] = folders.map((folder) => ({
      key: `folder-${folder.id}`,
      kind: "folder",
      folder,
    }));
    const unfiled = projects.filter((project) => !project.folderId);
    const listed = folders.length > 0 ? unfiled : projects;
    if (folders.length > 0 && listed.length > 0) {
      items.push({ key: "heading-unfiled", kind: "heading", title: "Unfiled" });
    }
    for (const project of listed) {
      items.push({ key: `project-${project.id}`, kind: "project", project });
    }
    return items;
  }, [folders, projects]);

  if (!ready) {
    return (
      <View style={[layout.screen, { alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!user) return <Redirect href="/login" />;

  const loading =
    (projectsQuery.isPending && !projectsQuery.data) ||
    (foldersQuery.isPending && !foldersQuery.data);

  return (
    <View style={[layout.screen, { paddingBottom: 0 }]}>
      <AppHeader
        title="Manuscripts"
        onSettings={() => router.push("/settings")}
        onNew={() => router.push("/new-manuscript")}
      />
      {error ? (
        <Text style={[layout.error, { marginHorizontal: 20, marginTop: 12 }]} role="alert">
          {error}
        </Text>
      ) : null}
      {loading && !error ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          scrollEnabled={true}
          data={rows}
          keyExtractor={(item) => item.key}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 20 }}
          refreshControl={
            <RefreshControl
              refreshing={
                (projectsQuery.isRefetching || foldersQuery.isRefetching) &&
                !projectsQuery.isPending &&
                !foldersQuery.isPending
              }
              onRefresh={() => {
                void projectsQuery.refetch();
                void foldersQuery.refetch();
              }}
              tintColor={colors.accent}
            />
          }
          ListHeaderComponent={
            <View>
              <Pressable
                style={[layout.primaryBtn, { marginBottom: 8 }]}
                onPress={() => router.push("/new-manuscript")}
                accessibilityRole="button"
                accessibilityLabel="Start a new manuscript"
              >
                <Text style={layout.primaryBtnText}>Start a new manuscript</Text>
              </Pressable>
              <Pressable
                style={[layout.ghostBtn, { marginBottom: 12 }]}
                onPress={() => router.push("/new-folder")}
                accessibilityRole="button"
                accessibilityLabel="New folder"
              >
                <Text style={layout.ghostBtnText}>New folder</Text>
              </Pressable>
            </View>
          }
          ListEmptyComponent={
            <Text style={[layout.body, { marginTop: 8 }]}>
              No manuscripts yet. Create one here - you do not need the web app for that.
            </Text>
          }
          renderItem={({ item }) => {
            if (item.kind === "heading") {
              return (
                <Text style={[layout.cardMeta, { marginBottom: 8, marginTop: 4 }]}>{item.title}</Text>
              );
            }
            if (item.kind === "folder") {
              const count = item.folder._count?.projects ?? item.folder.projects.length;
              return (
                <Pressable
                  style={layout.card}
                  onPress={() => router.push(`/folder/${item.folder.id}`)}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.folder.name} folder`}
                >
                  <Text style={layout.cardTitle}>{item.folder.name}</Text>
                  <Text style={layout.cardMeta}>
                    {count} manuscript{count === 1 ? "" : "s"}
                  </Text>
                  {item.folder.notes ? (
                    <Text style={layout.cardMeta} numberOfLines={2}>
                      {item.folder.notes}
                    </Text>
                  ) : null}
                </Pressable>
              );
            }
            return (
              <Pressable
                style={layout.card}
                onPress={() => router.push(`/project/${item.project.id}/chapters`)}
              >
                <Text style={layout.cardTitle}>{item.project.title || "Untitled Manuscript"}</Text>
                <Text style={layout.cardMeta}>
                  {[
                    item.project.genre,
                    item.project._count ? `${item.project._count.chapters} chapters` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "Manuscript"}
                </Text>
                {item.project.logline ? (
                  <Text style={layout.cardMeta}>{item.project.logline}</Text>
                ) : null}
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}
