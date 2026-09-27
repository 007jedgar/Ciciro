import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import Animated, { LinearTransition, SlideOutLeft } from "react-native-reanimated";
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
import { colors as parchmentColors, layout as parchmentLayout } from "../lib/theme";
import { useUndoableRemoval } from "../lib/undo-removal";
import { useReduceMotion } from "../lib/use-reduce-motion";
import { PressableCard } from "./PressableCard";
import { SkeletonList } from "./Skeleton";
import { UndoSnackbar } from "./UndoSnackbar";

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
  const colors = themed?.colors ?? parchmentColors;
  const notes = useScratchNotesQuery(projectId);
  const create = useCreateScratchNoteMutation();
  const remove = useDeleteScratchNoteMutation();
  const [error, setError] = useState<string | null>(null);
  const reduceMotion = useReduceMotion();
  const { hidden, notice, remove: removeWithUndo, undo } = useUndoableRemoval({
    onFailed: (_id, err) => setError(err instanceof ApiError ? err.message : t("scratch.deleteError")),
  });

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

  // No confirmation: the row slides out and Undo stays up for a few seconds.
  function removeNote(note: ScratchNote) {
    setError(null);
    removeWithUndo(note.id, t("scratch.removed"), () => remove.mutateAsync({ projectId, noteId: note.id }));
  }

  if (notes.isPending && !notes.data) {
    return (
      <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
        <SkeletonList count={4} accessibilityLabel={t("common.loading")} />
      </View>
    );
  }

  const list = (notes.data ?? []).filter((n) => !hidden.has(n.id));
  return (
    <View style={{ flex: 1 }}>
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
      <PressableCard
        style={[layout.card, { marginBottom: 16 }]}
        accent
        onPress={() => void add()}
        disabled={create.isPending}
        accessibilityRole="button"
        accessibilityLabel={t("scratch.new")}
      >
        <Text style={[layout.cardTitle, { color: colors.panel, opacity: create.isPending ? 0.6 : 1 }]}>{t("scratch.new")}</Text>
      </PressableCard>
      {list.length === 0 && !notes.isError ? (
        <Text style={layout.body}>{t("scratch.empty")}</Text>
      ) : null}
      {list.map((note) => {
        const title = scratchNoteTitle(note, t("scratch.untitled"));
        const excerpt = scratchNoteExcerpt(note);
        return (
          <Animated.View
            key={note.id}
            exiting={reduceMotion ? undefined : SlideOutLeft.duration(200)}
            layout={reduceMotion ? undefined : LinearTransition.duration(200)}
          >
            <PressableCard
              style={[layout.card, { marginBottom: 12 }]}
              onPress={() => onOpen(note.id)}
              onLongPress={() => removeNote(note)}
              accessibilityRole="button"
              accessibilityLabel={t("scratch.open", { title })}
              accessibilityHint={t("scratch.deleteHint")}
              accessibilityActions={[{ name: "delete", label: t("common.delete") }]}
              onAccessibilityAction={() => removeNote(note)}
            >
              <Text style={layout.cardTitle} numberOfLines={1}>
                {title}
              </Text>
              {excerpt ? (
                <Text style={layout.cardMeta} numberOfLines={2}>
                  {excerpt}
                </Text>
              ) : null}
            </PressableCard>
          </Animated.View>
        );
      })}
    </ScrollView>
    <UndoSnackbar message={notice?.message ?? null} onUndo={undo} />
    </View>
  );
}
