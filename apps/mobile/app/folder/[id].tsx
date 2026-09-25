import { useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useStackBack } from "../../lib/use-stack-back";
import { useTranslation } from "react-i18next";
import { AppHeader, useAppHeaderHeight } from "../../components/AppHeader";
import { FolderTitleEditor } from "../../components/FolderTitleEditor";
import { PlusIcon } from "../../components/icons";
import { SkeletonList } from "../../components/Skeleton";
import {
  ApiError,
  useAddProjectsToFolderMutation,
  useDeleteFolderMutation,
  useFolderQuery,
  usePatchFolderMutation,
  useProjectsQuery,
  useRemoveProjectsFromFolderMutation,
} from "../../lib/api";
import { useAppTheme } from "../../lib/settings";
import { useSession } from "../../lib/session";

function errorText(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export default function FolderScreen() {
  const router = useRouter();
  const { backOr } = useStackBack();
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const folderId = typeof id === "string" ? id : "";
  const { user, ready } = useSession();
  const { layout, colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const headerHeight = useAppHeaderHeight();

  const folderQuery = useFolderQuery(folderId, { enabled: Boolean(user) && Boolean(folderId) });
  const projectsQuery = useProjectsQuery({ enabled: Boolean(user) });
  const patchFolder = usePatchFolderMutation();
  const deleteFolder = useDeleteFolderMutation();
  const addProjects = useAddProjectsToFolderMutation();
  const removeProjects = useRemoveProjectsFromFolderMutation();

  const folder = folderQuery.data ?? null;
  const [actionError, setActionError] = useState<string | null>(null);

  const unfiled = useMemo(
    () => (projectsQuery.data ?? []).filter((project) => !project.folderId),
    [projectsQuery.data]
  );

  if (!ready) {
    return (
      <View style={[layout.screen, { paddingHorizontal: 20, paddingTop: 24 }]}>
        <SkeletonList count={5} accessibilityLabel={t("common.loading")} />
      </View>
    );
  }

  if (!user) return <Redirect href="/login" />;

  const loadError = folderQuery.error
    ? errorText(folderQuery.error, t("folder.loadError"))
    : null;
  const error = actionError ?? loadError;

  function confirmDelete() {
    if (!folder) return;
    Alert.alert(t("folder.deleteTitle"), t("folder.deleteMessage"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: () => {
          setActionError(null);
          deleteFolder.mutate(folder.id, {
            onSuccess: () => router.replace("/manuscripts"),
            onError: (err) => setActionError(errorText(err, t("folder.deleteError"))),
          });
        },
      },
    ]);
  }

  function remove(projectId: string) {
    if (!folder) return;
    setActionError(null);
    removeProjects.mutate(
      { id: folder.id, projectIds: [projectId] },
      { onError: (err) => setActionError(errorText(err, t("folder.saveError"))) }
    );
  }

  function add(projectId: string) {
    if (!folder) return;
    setActionError(null);
    addProjects.mutate(
      { id: folder.id, projectIds: [projectId] },
      { onError: (err) => setActionError(errorText(err, t("folder.saveError"))) }
    );
  }

  return (
    <View style={layout.screen}>
      <AppHeader
        title={folder?.name || t("folder.fallbackTitle")}
        onBack={() => backOr("/manuscripts")}
        backAccessibilityLabel={t("folder.backToManuscripts")}
        floating
      />
      <ScrollView
        contentContainerStyle={{
          padding: 20,
          paddingTop: headerHeight + 20,
          paddingBottom: insets.bottom + 96,
        }}
        scrollIndicatorInsets={{ top: headerHeight }}
      >
        {error ? (
          <Text style={[layout.error, { marginTop: 0, marginBottom: 12 }]} role="alert">
            {error}
          </Text>
        ) : null}
        {!folder && !loadError ? (
          <SkeletonList count={5} accessibilityLabel={t("common.loading")} />
        ) : folder ? (
          <>
            <FolderTitleEditor
              name={folder.name}
              notes={folder.notes}
              onSave={async (nextName, nextNotes) => {
                await patchFolder.mutateAsync({
                  id: folder.id,
                  body: { name: nextName, notes: nextNotes },
                });
              }}
            />

            {folder.projects.length === 0 ? (
              <Text style={[layout.body, { marginBottom: 16 }]}>{t("folder.empty")}</Text>
            ) : (
              folder.projects.map((item) => (
                <View key={item.id} style={layout.card}>
                  <Pressable onPress={() => router.push(`/project/${item.id}/chapters`)}>
                    <Text style={layout.cardTitle}>{item.title || t("manuscripts.untitled")}</Text>
                    <Text style={layout.cardMeta}>
                      {[
                        item.genre,
                        item._count
                          ? t("manuscripts.chapterCount", { count: item._count.chapters })
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || t("manuscripts.fallbackKind")}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => remove(item.id)}
                    accessibilityRole="button"
                    accessibilityLabel={t("folder.removeA11y", { title: item.title })}
                    style={{ marginTop: 8 }}
                  >
                    <Text style={layout.ghostBtnText}>{t("folder.remove")}</Text>
                  </Pressable>
                </View>
              ))
            )}

            {unfiled.length > 0 ? (
              <>
                <Text style={[layout.cardMeta, { marginTop: 8, marginBottom: 8 }]}>
                  {t("folder.addFromLibrary")}
                </Text>
                {unfiled.map((item) => (
                  <Pressable
                    key={item.id}
                    style={layout.card}
                    onPress={() => add(item.id)}
                    accessibilityRole="button"
                    accessibilityLabel={t("folder.addA11y", { title: item.title })}
                  >
                    <Text style={layout.cardTitle}>{item.title || t("manuscripts.untitled")}</Text>
                    <Text style={layout.cardMeta}>{t("folder.addToFolder")}</Text>
                  </Pressable>
                ))}
              </>
            ) : null}

            <Pressable
              style={layout.ghostBtn}
              onPress={confirmDelete}
              accessibilityRole="button"
              accessibilityLabel={t("folder.deleteA11y")}
            >
              <Text style={[layout.ghostBtnText, { color: colors.danger }]}>
                {t("folder.delete")}
              </Text>
            </Pressable>
          </>
        ) : null}
      </ScrollView>
      {folder ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("folder.startNewA11y")}
          onPress={() =>
            router.push({ pathname: "/new-manuscript", params: { folderId: folder.id } })
          }
          style={[
            styles.fab,
            {
              backgroundColor: colors.accent,
              shadowColor: colors.accent,
              bottom: insets.bottom + 16,
            },
          ]}
        >
          <PlusIcon color={colors.panel} size={22} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    right: 16,
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
});
