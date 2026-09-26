import { useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { ApiError } from "../lib/api/client";
import {
  useCreateScratchNoteMutation,
  useDeleteScratchNoteMutation,
  useScratchNotesQuery,
} from "../lib/api";
import type { ScratchNote } from "../lib/api/types";
import { scratchNoteExcerpt, scratchNoteTitle } from "../lib/scratch";
import { useOptionalAppTheme } from "../lib/settings";
import { layout as parchmentLayout } from "../lib/theme";
import { SkeletonList } from "./Skeleton";

/** The scratchpad's list: every note for the manuscript, newest edit first. */
export function ScratchNotes({
  projectId,
  onOpen,
}: {
  projectId: string;
  onOpen: (noteId: string) => void;
}) {
  const { t } = useTranslation();
  const themed = useOptionalAppTheme();
  const layout = themed?.layout ?? parchmentLayout;
  const notes = useScratchNotesQuery(projectId);
  const create = useCreateScratchNoteMutation();
  const remove = useDeleteScratchNoteMutation();
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (create.isPending) return;
    setError(null);
    try {
      const note = await create.mutateAsync({ projectId });
      onOpen(note.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("scratch.createError"));
    }
  }

  function confirmDelete(note: ScratchNote) {
    const title = scratchNoteTitle(note, t("scratch.untitled"));
    Alert.alert(t("scratch.deleteTitle", { title }), t("scratch.deleteMessage"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: () => {
          setError(null);
          remove.mutateAsync({ projectId, noteId: note.id }).catch((err: unknown) => {
            setError(err instanceof ApiError ? err.message : t("scratch.deleteError"));
          });
        },
      },
    ]);
  }

  if (notes.isPending && !notes.data) {
    return (
      <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
        <SkeletonList count={4} accessibilityLabel={t("common.loading")} />
      </View>
    );
  }

  const list = notes.data ?? [];
  return (
    <ScrollView
      testID="scratch-notes"
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[layout.body, { marginBottom: 16 }]}>{t("scratch.blurb")}</Text>
      {error ? (
        <Text style={[layout.error, { marginTop: 0, marginBottom: 12 }]} role="alert">
          {error}
        </Text>
      ) : null}
      {notes.isError ? (
        <Text style={[layout.error, { marginTop: 0, marginBottom: 12 }]} role="alert">
          {t("scratch.loadError")}
        </Text>
      ) : null}
      <Pressable
        style={[layout.card, { marginBottom: 16, opacity: create.isPending ? 0.6 : 1 }]}
        onPress={() => void add()}
        disabled={create.isPending}
        accessibilityRole="button"
        accessibilityLabel={t("scratch.new")}
      >
        <Text style={layout.cardTitle}>{t("scratch.new")}</Text>
      </Pressable>
      {list.length === 0 && !notes.isError ? (
        <Text style={layout.body}>{t("scratch.empty")}</Text>
      ) : null}
      {list.map((note) => {
        const title = scratchNoteTitle(note, t("scratch.untitled"));
        const excerpt = scratchNoteExcerpt(note);
        return (
          <Pressable
            key={note.id}
            style={[layout.card, { marginBottom: 12 }]}
            onPress={() => onOpen(note.id)}
            onLongPress={() => confirmDelete(note)}
            accessibilityRole="button"
            accessibilityLabel={t("scratch.open", { title })}
            accessibilityHint={t("scratch.deleteHint")}
            accessibilityActions={[{ name: "delete", label: t("common.delete") }]}
            onAccessibilityAction={() => confirmDelete(note)}
          >
            <Text style={layout.cardTitle} numberOfLines={1}>
              {title}
            </Text>
            {excerpt ? (
              <Text style={layout.cardMeta} numberOfLines={2}>
                {excerpt}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
