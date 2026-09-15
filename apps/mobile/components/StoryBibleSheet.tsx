import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useTranslation } from "react-i18next";
import { ApiError } from "../lib/api/client";
import {
  useBibleFileQuery,
  useBibleIndexQuery,
  useCreateBibleCharacterMutation,
  useWriteBibleMutation,
} from "../lib/api";
import { useOptionalAppTheme } from "../lib/settings";
import { colors as parchmentColors } from "../lib/theme";
import { GlassSheet } from "./GlassSheet";
import { ChevronLeftIcon } from "./icons";

const StoryBibleUiContext = createContext<{ openBible: () => void } | null>(null);

export function useStoryBibleUi() {
  const ctx = useContext(StoryBibleUiContext);
  if (!ctx) throw new Error("useStoryBibleUi must be used within StoryBibleHost");
  return ctx;
}

export function StoryBibleHost({
  projectId,
  children,
}: {
  projectId: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <StoryBibleUiContext.Provider value={{ openBible: () => setOpen(true) }}>
      {children}
      <StoryBibleSheet projectId={projectId} visible={open} onClose={() => setOpen(false)} />
    </StoryBibleUiContext.Provider>
  );
}

/**
 * The manuscript's shared memory: markdown files Ciciro reads to plan and writes
 * decisions back to. Same files as the web story bible drawer.
 */
export function StoryBibleSheet({
  projectId,
  visible,
  onClose,
}: {
  projectId: string;
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const themed = useOptionalAppTheme();
  const colors = themed?.colors ?? parchmentColors;
  const autoCorrect = themed?.settings.autoCorrect ?? true;
  const index = useBibleIndexQuery(projectId, { enabled: visible });
  const write = useWriteBibleMutation();
  const createCharacter = useCreateBibleCharacterMutation();
  const [openPath, setOpenPath] = useState<string | null>(null);
  const file = useBibleFileQuery(projectId, openPath ?? "", {
    enabled: visible && Boolean(openPath),
  });
  const [content, setContent] = useState("");
  const [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [newChar, setNewChar] = useState("");
  const [error, setError] = useState<string | null>(null);
  const loadedPath = useRef<string | null>(null);

  useEffect(() => {
    if (visible) return;
    setOpenPath(null);
    setContent("");
    setDirty(false);
    setNewChar("");
    setError(null);
    loadedPath.current = null;
  }, [visible]);

  useEffect(() => {
    if (!openPath) {
      loadedPath.current = null;
      return;
    }
    if (!file.data || file.data.path !== openPath) return;
    if (loadedPath.current === openPath) return;
    loadedPath.current = openPath;
    setContent(file.data.content);
    setRevision(file.data.revision ?? 0);
    setDirty(false);
  }, [openPath, file.data]);

  const save = useCallback(async () => {
    if (!openPath || !dirty) return true;
    setError(null);
    try {
      const result = await write.mutateAsync({
        projectId,
        path: openPath,
        content,
        expectedRevision: revision,
      });
      setRevision(result.revision);
      setDirty(false);
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("bible.saveError"));
      return false;
    }
  }, [content, dirty, openPath, projectId, revision, t, write]);

  async function leaveFile() {
    if (dirty) {
      const ok = await save();
      if (!ok) return;
    }
    setOpenPath(null);
    setError(null);
  }

  async function dismiss() {
    if (openPath && dirty) {
      const ok = await save();
      if (!ok) return;
    }
    onClose();
  }

  async function addCharacter() {
    const name = newChar.trim();
    if (!name || createCharacter.isPending) return;
    setError(null);
    try {
      const created = await createCharacter.mutateAsync({ projectId, newCharacter: name });
      setNewChar("");
      setOpenPath(created.path);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("bible.saveError"));
    }
  }

  const entries = index.data ?? [];

  return (
    <GlassSheet
      visible={visible}
      onClose={() => void dismiss()}
      title={t("bible.title")}
      snapPoints={[0.72, 0.94]}
      testID="story-bible-sheet"
    >
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        {error ? (
          <Text style={[styles.error, { color: colors.danger }]} role="alert">
            {error}
          </Text>
        ) : null}

        {!openPath ? (
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={[styles.blurb, { color: colors.inkSoft }]}>{t("bible.blurb")}</Text>

            {index.isPending ? (
              <ActivityIndicator
                color={colors.accent}
                style={styles.spinner}
                accessibilityLabel={t("common.loading")}
              />
            ) : null}

            {index.isError ? (
              <Text style={[styles.empty, { color: colors.danger }]}>{t("bible.loadError")}</Text>
            ) : null}

            {!index.isPending && entries.length === 0 ? (
              <Text style={[styles.empty, { color: colors.inkSoft }]}>{t("bible.empty")}</Text>
            ) : null}

            {entries.map((entry) => (
              <Pressable
                key={entry.path}
                accessibilityRole="button"
                accessibilityLabel={t("bible.openA11y", { path: entry.path })}
                onPress={() => setOpenPath(entry.path)}
                style={[styles.file, { borderColor: colors.line }]}
              >
                <Text style={[styles.filePath, { color: colors.ink }]}>{entry.path}</Text>
                <Text style={[styles.fileSummary, { color: colors.inkSoft }]} numberOfLines={2}>
                  {entry.summary}
                </Text>
              </Pressable>
            ))}

            <View style={styles.addRow}>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.panel,
                    borderColor: colors.line,
                    color: colors.ink,
                  },
                ]}
                accessibilityLabel={t("bible.newCharacter")}
                placeholder={t("bible.newCharacter")}
                placeholderTextColor={colors.inkSoft}
                value={newChar}
                onChangeText={setNewChar}
                onSubmitEditing={() => void addCharacter()}
                autoCorrect={autoCorrect}
                spellCheck={autoCorrect}
                returnKeyType="done"
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("bible.addCharacter")}
                onPress={() => void addCharacter()}
                disabled={createCharacter.isPending || !newChar.trim()}
                style={[
                  styles.addBtn,
                  {
                    backgroundColor: colors.accent,
                    opacity: createCharacter.isPending || !newChar.trim() ? 0.5 : 1,
                  },
                ]}
              >
                <Text style={[styles.addBtnText, { color: colors.panel }]}>
                  {t("bible.addCharacter")}
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        ) : (
          <View style={styles.editor}>
            <View style={styles.editorBar}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("bible.allFiles")}
                onPress={() => void leaveFile()}
                hitSlop={8}
                style={styles.backBtn}
              >
                <ChevronLeftIcon color={colors.ink} size={18} />
                <Text style={[styles.backLabel, { color: colors.ink }]}>{t("bible.allFiles")}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={dirty ? t("common.save") : t("bible.saved")}
                onPress={() => void save()}
                disabled={!dirty || write.isPending}
                style={[
                  styles.saveBtn,
                  {
                    backgroundColor: dirty ? colors.accent : colors.panel2,
                    opacity: write.isPending ? 0.6 : 1,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.saveBtnText,
                    { color: dirty ? colors.panel : colors.inkSoft },
                  ]}
                >
                  {write.isPending
                    ? t("common.saving")
                    : dirty
                      ? t("common.save")
                      : t("bible.saved")}
                </Text>
              </Pressable>
            </View>
            <Text style={[styles.openPath, { color: colors.inkSoft }]}>{openPath}</Text>
            {file.isPending && !file.data ? (
              <ActivityIndicator
                color={colors.accent}
                style={styles.spinner}
                accessibilityLabel={t("common.loading")}
              />
            ) : (
              <TextInput
                style={[
                  styles.textarea,
                  {
                    backgroundColor: colors.panel,
                    borderColor: colors.line,
                    color: colors.ink,
                  },
                ]}
                accessibilityLabel={openPath}
                value={content}
                onChangeText={(next) => {
                  setContent(next);
                  setDirty(true);
                }}
                multiline
                textAlignVertical="top"
                autoCorrect={autoCorrect}
                spellCheck={autoCorrect}
              />
            )}
          </View>
        )}
      </KeyboardAvoidingView>
    </GlassSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingBottom: 8 },
  blurb: { fontSize: 13, lineHeight: 19, marginBottom: 14 },
  spinner: { marginVertical: 24 },
  empty: { fontSize: 14, lineHeight: 21, marginVertical: 12 },
  error: { fontSize: 13, lineHeight: 18, marginBottom: 10 },
  file: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
  },
  filePath: { fontSize: 14, fontWeight: "600" },
  fileSummary: { fontSize: 13, lineHeight: 18, marginTop: 4 },
  addRow: { flexDirection: "row", gap: 8, marginTop: 16, alignItems: "center" },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  addBtn: {
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  addBtnText: { fontSize: 15, fontWeight: "600" },
  editor: { flex: 1, minHeight: 280 },
  editorBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 2, paddingVertical: 4 },
  backLabel: { fontSize: 14, fontWeight: "600" },
  saveBtn: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  saveBtnText: { fontSize: 13, fontWeight: "600" },
  openPath: { fontSize: 12, fontWeight: "600", marginBottom: 8 },
  textarea: {
    flex: 1,
    minHeight: 180,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    lineHeight: 22,
    fontFamily: "Menlo",
  },
});
