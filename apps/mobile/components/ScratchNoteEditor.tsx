import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useTranslation } from "react-i18next";
import { ApiError } from "../lib/api/client";
import { useScratchNotesQuery, useUpdateScratchNoteMutation } from "../lib/api";
import type { ScratchNote } from "../lib/api/types";
import {
  SCRATCH_CONTENT_MAX,
  SCRATCH_SAVE_DELAY_MS,
  SCRATCH_TITLE_MAX,
  scratchConflict,
} from "../lib/scratch";
import { useOptionalAppTheme } from "../lib/settings";
import { colors as parchmentColors, layout as parchmentLayout } from "../lib/theme";
import { SkeletonList } from "./Skeleton";

/**
 * One scratch note: a title and free text, saved a moment after typing stops.
 * Saves carry the revision they were made against, so an edit from another
 * device is never silently overwritten; the author is asked which to keep.
 */
export function ScratchNoteEditor({
  projectId,
  noteId,
  onDirtyChange,
  saveRef,
}: {
  projectId: string;
  noteId: string;
  onDirtyChange?: (dirty: boolean, saving: boolean) => void;
  saveRef?: MutableRefObject<(() => Promise<boolean>) | null>;
}) {
  const { t } = useTranslation();
  const themed = useOptionalAppTheme();
  const layout = themed?.layout ?? parchmentLayout;
  const colors = themed?.colors ?? parchmentColors;
  const autoCorrect = themed?.settings.autoCorrect ?? true;
  const notes = useScratchNotesQuery(projectId);
  const update = useUpdateScratchNoteMutation();
  const stored = notes.data?.find((n) => n.id === noteId) ?? null;

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remote, setRemote] = useState<ScratchNote | null>(null);

  // Live copies: the debounced save and the refresh effect outlive any one render.
  const draft = useRef({ title: "", content: "" });
  const revision = useRef(0);
  const loadedId = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const conflicted = useRef(false);
  const inflight = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const adopt = useCallback((note: ScratchNote) => {
    draft.current = { title: note.title, content: note.content };
    revision.current = note.revision;
    dirtyRef.current = false;
    conflicted.current = false;
    setTitle(note.title);
    setContent(note.content);
    setDirty(false);
    setRemote(null);
  }, []);

  useEffect(() => {
    if (!stored) return;
    // First load, or another device saved and we have nothing of our own pending.
    if (loadedId.current !== stored.id) {
      loadedId.current = stored.id;
      adopt(stored);
    } else if (!dirtyRef.current && !conflicted.current && stored.revision !== revision.current) {
      adopt(stored);
    }
  }, [stored, adopt]);

  const save = useCallback(async (): Promise<boolean> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (inflight.current) await inflight.current;
    if (!dirtyRef.current) return true;
    if (conflicted.current) return false;
    const sent = { ...draft.current };
    const run = (async () => {
      setError(null);
      try {
        const saved = await update.mutateAsync({
          projectId,
          noteId,
          body: { ...sent, expectedRevision: revision.current },
        });
        revision.current = saved.revision;
        const same =
          draft.current.title === sent.title && draft.current.content === sent.content;
        if (same) {
          dirtyRef.current = false;
          setDirty(false);
        }
        return true;
      } catch (err) {
        const conflict = scratchConflict(err);
        if (conflict) {
          conflicted.current = true;
          setRemote(conflict.note);
        } else {
          setError(err instanceof ApiError ? err.message : t("scratch.saveError"));
        }
        return false;
      }
    })();
    inflight.current = run;
    const ok = await run;
    inflight.current = null;
    return ok && !dirtyRef.current;
  }, [noteId, projectId, t, update]);

  const saveLatest = useRef(save);
  saveLatest.current = save;

  function edit(next: Partial<{ title: string; content: string }>) {
    draft.current = { ...draft.current, ...next };
    if (next.title !== undefined) setTitle(next.title);
    if (next.content !== undefined) setContent(next.content);
    dirtyRef.current = true;
    setDirty(true);
    if (conflicted.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void saveLatest.current(), SCRATCH_SAVE_DELAY_MS);
  }

  // Leaving with typing still waiting on the timer saves it first.
  useEffect(
    () => () => {
      if (dirtyRef.current && !conflicted.current) void saveLatest.current();
    },
    []
  );

  useEffect(() => {
    if (saveRef) saveRef.current = save;
    onDirtyChange?.(dirty, update.isPending);
  }, [dirty, onDirtyChange, save, saveRef, update.isPending]);

  function takeTheirs() {
    if (remote) adopt(remote);
  }

  function keepMine() {
    if (!remote) return;
    revision.current = remote.revision;
    conflicted.current = false;
    setRemote(null);
    void save();
  }

  if (notes.isPending && !notes.data) {
    return (
      <View style={layout.padded}>
        <SkeletonList count={3} accessibilityLabel={t("common.loading")} />
      </View>
    );
  }

  if (!stored) {
    return (
      <View style={layout.padded}>
        <Text style={layout.error} role="alert">
          {t("scratch.missing")}
        </Text>
      </View>
    );
  }

  const field = {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.ink,
  } as const;

  return (
    <KeyboardAwareScrollView
      testID="scratch-editor"
      style={layout.screen}
      contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 20, paddingBottom: 24 }}
      keyboardShouldPersistTaps="handled"
      bottomOffset={24}
    >
      {error ? (
        <Text style={[layout.error, { marginTop: 0, marginBottom: 12 }]} role="alert">
          {error}
        </Text>
      ) : null}
      {remote ? (
        <View style={[layout.card, { marginBottom: 12 }]} accessibilityRole="alert">
          <Text style={layout.cardTitle}>{t("scratch.conflictTitle")}</Text>
          <Text style={layout.cardMeta}>{t("scratch.conflictBody")}</Text>
          <View style={{ flexDirection: "row", gap: 16, marginTop: 10 }}>
            <Pressable
              onPress={takeTheirs}
              accessibilityRole="button"
              accessibilityLabel={t("scratch.useTheirs")}
            >
              <Text style={{ color: colors.accent, fontWeight: "600" }}>
                {t("scratch.useTheirs")}
              </Text>
            </Pressable>
            <Pressable
              onPress={keepMine}
              accessibilityRole="button"
              accessibilityLabel={t("scratch.keepMine")}
            >
              <Text style={{ color: colors.accent, fontWeight: "600" }}>
                {t("scratch.keepMine")}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      <TextInput
        style={[field, { fontSize: 18, fontWeight: "600", marginBottom: 12 }]}
        accessibilityLabel={t("scratch.titleLabel")}
        placeholder={t("scratch.titlePlaceholder")}
        placeholderTextColor={colors.inkSoft}
        value={title}
        onChangeText={(next) => edit({ title: next })}
        maxLength={SCRATCH_TITLE_MAX}
        autoCorrect={autoCorrect}
        spellCheck={autoCorrect}
      />
      <TextInput
        style={[
          field,
          { flexGrow: 1, minHeight: 240, fontSize: 16, lineHeight: 24, textAlignVertical: "top" },
        ]}
        accessibilityLabel={t("scratch.bodyLabel")}
        placeholder={t("scratch.bodyPlaceholder")}
        placeholderTextColor={colors.inkSoft}
        value={content}
        onChangeText={(next) => edit({ content: next })}
        maxLength={SCRATCH_CONTENT_MAX}
        multiline
        scrollEnabled={false}
        autoCorrect={autoCorrect}
        spellCheck={autoCorrect}
      />
    </KeyboardAwareScrollView>
  );
}
