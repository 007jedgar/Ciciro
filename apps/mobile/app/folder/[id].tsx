import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { AppHeader } from "../../components/AppHeader";
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
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const folderId = typeof id === "string" ? id : "";
  const { user, ready } = useSession();
  const { layout, colors, settings } = useAppTheme();

  const folderQuery = useFolderQuery(folderId, { enabled: Boolean(user) && Boolean(folderId) });
  const projectsQuery = useProjectsQuery({ enabled: Boolean(user) });
  const patchFolder = usePatchFolderMutation();
  const deleteFolder = useDeleteFolderMutation();
  const addProjects = useAddProjectsToFolderMutation();
  const removeProjects = useRemoveProjectsFromFolderMutation();

  const folder = folderQuery.data ?? null;
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  // Seed the inputs once per folder so a background refetch never clobbers an
  // in-progress edit.
  const seededRef = useRef<string | null>(null);
  useEffect(() => {
    if (folder && seededRef.current !== folder.id) {
      seededRef.current = folder.id;
      setName(folder.name);
      setNotes(folder.notes);
    }
  }, [folder]);

  const unfiled = useMemo(
    () => (projectsQuery.data ?? []).filter((project) => !project.folderId),
    [projectsQuery.data]
  );

  if (!ready) {
    return (
      <View style={[layout.screen, { alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!user) return <Redirect href="/login" />;

  const loadError = folderQuery.error
    ? errorText(folderQuery.error, t("folder.loadError"))
    : null;
  const error = actionError ?? loadError;

  const dirty = folder ? name.trim() !== folder.name || notes.trim() !== folder.notes : false;
  const saving = patchFolder.isPending;

  function save() {
    if (!folder || !dirty || saving) return;
    setActionError(null);
    patchFolder.mutate(
      { id: folder.id, body: { name: name.trim(), notes: notes.trim() } },
      { onError: (err) => setActionError(errorText(err, t("folder.saveError"))) }
    );
  }

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
        onBack={() => (router.canGoBack() ? router.back() : router.navigate("/manuscripts"))}
        backAccessibilityLabel={t("folder.backToManuscripts")}
      />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48 }}>
        {error ? (
          <Text style={[layout.error, { marginTop: 0, marginBottom: 12 }]} role="alert">
            {error}
          </Text>
        ) : null}
        {!folder && !loadError ? (
          <ActivityIndicator color={colors.accent} />
        ) : folder ? (
          <>
            <TextInput
              style={layout.input}
              aria-label={t("newFolder.nameLabel")}
              value={name}
              onChangeText={setName}
              placeholder={t("newFolder.nameLabel")}
              placeholderTextColor={colors.inkSoft}
              autoCorrect={settings.autoCorrect}
            />
            <TextInput
              style={[layout.input, { minHeight: 88, textAlignVertical: "top" }]}
              aria-label={t("newFolder.notesLabel")}
              value={notes}
              onChangeText={setNotes}
              placeholder={t("newFolder.notesPlaceholder")}
              placeholderTextColor={colors.inkSoft}
              multiline
              autoCorrect={settings.autoCorrect}
            />
            {dirty ? (
              <Pressable
                style={[layout.primaryBtn, { marginBottom: 16 }]}
                onPress={save}
                disabled={saving}
                accessibilityRole="button"
                accessibilityLabel={t("folder.saveA11y")}
              >
                <Text style={layout.primaryBtnText}>
                  {saving ? t("common.saving") : t("common.save")}
                </Text>
              </Pressable>
            ) : null}

            <Pressable
              style={[layout.primaryBtn, { marginBottom: 16 }]}
              onPress={() =>
                router.push({ pathname: "/new-manuscript", params: { folderId: folder.id } })
              }
              accessibilityRole="button"
              accessibilityLabel={t("folder.startNewA11y")}
            >
              <Text style={layout.primaryBtnText}>{t("folder.startNew")}</Text>
            </Pressable>

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
    </View>
  );
}
