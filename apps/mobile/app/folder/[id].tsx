import { useCallback, useEffect, useState } from "react";
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
import { AppHeader } from "../../components/AppHeader";
import { ApiError } from "../../lib/api";
import {
  addManuscriptsToFolder,
  deleteFolder,
  getFolder,
  removeManuscriptsFromFolder,
  updateFolder,
} from "../../lib/folders";
import { listManuscripts } from "../../lib/manuscripts";
import { useAppTheme } from "../../lib/settings";
import { useSession } from "../../lib/session";
import type { Folder, ProjectListItem } from "../../lib/types";

export default function FolderScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, ready } = useSession();
  const { layout, colors, settings } = useAppTheme();
  const [folder, setFolder] = useState<Folder | null>(null);
  const [unfiled, setUnfiled] = useState<ProjectListItem[]>([]);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const [nextFolder, projects] = await Promise.all([getFolder(id), listManuscripts()]);
      setFolder(nextFolder);
      setName(nextFolder.name);
      setNotes(nextFolder.notes);
      setUnfiled(projects.filter((project) => !project.folderId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load folder.");
    }
  }, [id]);

  useEffect(() => {
    if (user && id) void load();
  }, [user, id, load]);

  if (!ready) {
    return (
      <View style={[layout.screen, { alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!user) return <Redirect href="/login" />;

  const dirty = folder ? name.trim() !== folder.name || notes.trim() !== folder.notes : false;

  async function save() {
    if (!folder || !dirty || saving) return;
    setSaving(true);
    try {
      const next = await updateFolder(folder.id, { name, notes });
      setFolder(next);
      setName(next.name);
      setNotes(next.notes);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save folder.");
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete() {
    if (!folder) return;
    Alert.alert(
      "Delete folder?",
      "Manuscripts stay in your library, unfiled.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void (async () => {
              try {
                await deleteFolder(folder.id);
                router.replace("/manuscripts");
              } catch (err) {
                setError(err instanceof ApiError ? err.message : "Could not delete folder.");
              }
            })();
          },
        },
      ]
    );
  }

  return (
    <View style={layout.screen}>
      <AppHeader
        title={folder?.name || "Folder"}
        onBack={() => (router.canGoBack() ? router.back() : router.navigate("/manuscripts"))}
        backAccessibilityLabel="Back to manuscripts"
      />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48 }}>
      {error ? (
        <Text style={[layout.error, { marginTop: 0, marginBottom: 12 }]} role="alert">
          {error}
        </Text>
      ) : null}
      {!folder && !error ? (
        <ActivityIndicator color={colors.accent} />
      ) : folder ? (
        <>
          <TextInput
            style={layout.input}
            aria-label="Folder name"
            value={name}
            onChangeText={setName}
            placeholder="Folder name"
            placeholderTextColor={colors.inkSoft}
            autoCorrect={settings.autoCorrect}
          />
          <TextInput
            style={[layout.input, { minHeight: 88, textAlignVertical: "top" }]}
            aria-label="Notes"
            value={notes}
            onChangeText={setNotes}
            placeholder="Notes (optional)"
            placeholderTextColor={colors.inkSoft}
            multiline
            autoCorrect={settings.autoCorrect}
          />
          {dirty ? (
            <Pressable
              style={[layout.primaryBtn, { marginBottom: 16 }]}
              onPress={() => void save()}
              accessibilityRole="button"
              accessibilityLabel="Save folder"
            >
              <Text style={layout.primaryBtnText}>{saving ? "Saving..." : "Save"}</Text>
            </Pressable>
          ) : null}

          <Pressable
            style={[layout.primaryBtn, { marginBottom: 16 }]}
            onPress={() =>
              router.push({ pathname: "/new-manuscript", params: { folderId: folder.id } })
            }
            accessibilityRole="button"
            accessibilityLabel="Start a new manuscript in this folder"
          >
            <Text style={layout.primaryBtnText}>Start a new manuscript</Text>
          </Pressable>

          {folder.projects.length === 0 ? (
            <Text style={[layout.body, { marginBottom: 16 }]}>
              No manuscripts in this folder yet.
            </Text>
          ) : (
            folder.projects.map((item) => (
              <View key={item.id} style={layout.card}>
                <Pressable onPress={() => router.push(`/project/${item.id}/chapters`)}>
                  <Text style={layout.cardTitle}>{item.title || "Untitled Manuscript"}</Text>
                  <Text style={layout.cardMeta}>
                    {[item.genre, item._count ? `${item._count.chapters} chapters` : null]
                      .filter(Boolean)
                      .join(" · ") || "Manuscript"}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    void removeManuscriptsFromFolder(folder.id, [item.id]).then(load);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${item.title} from folder`}
                  style={{ marginTop: 8 }}
                >
                  <Text style={layout.ghostBtnText}>Remove from folder</Text>
                </Pressable>
              </View>
            ))
          )}

          {unfiled.length > 0 ? (
            <>
              <Text style={[layout.cardMeta, { marginTop: 8, marginBottom: 8 }]}>
                ADD FROM LIBRARY
              </Text>
              {unfiled.map((item) => (
                <Pressable
                  key={item.id}
                  style={layout.card}
                  onPress={() => {
                    void addManuscriptsToFolder(folder.id, [item.id]).then(load);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${item.title} to folder`}
                >
                  <Text style={layout.cardTitle}>{item.title || "Untitled Manuscript"}</Text>
                  <Text style={layout.cardMeta}>Add to this folder</Text>
                </Pressable>
              ))}
            </>
          ) : null}

          <Pressable
            style={layout.ghostBtn}
            onPress={confirmDelete}
            accessibilityRole="button"
            accessibilityLabel="Delete folder"
          >
            <Text style={[layout.ghostBtnText, { color: colors.danger }]}>Delete folder</Text>
          </Pressable>
        </>
      ) : null}
      </ScrollView>
    </View>
  );
}
