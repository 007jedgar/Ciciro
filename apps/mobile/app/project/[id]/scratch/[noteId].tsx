import { useCallback, useRef, useState } from "react";
import { Redirect, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { AppHeader } from "../../../../components/AppHeader";
import { ScratchNoteEditor } from "../../../../components/ScratchNoteEditor";
import { scratchListHref } from "../../../../lib/scratch";
import { useSession } from "../../../../lib/session";
import { useAppTheme } from "../../../../lib/settings";
import { useStackBack } from "../../../../lib/use-stack-back";

export default function ScratchNoteScreen() {
  const { backOr } = useStackBack();
  const { t } = useTranslation();
  const { id, noteId: noteParam } = useLocalSearchParams<{ id: string; noteId: string }>();
  const { user, ready } = useSession();
  const { layout } = useAppTheme();
  const projectId = typeof id === "string" ? id : "";
  const noteId = typeof noteParam === "string" ? noteParam : "";
  const saveRef = useRef<(() => Promise<boolean>) | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const onDirtyChange = useCallback((nextDirty: boolean, nextSaving: boolean) => {
    setDirty(nextDirty);
    setSaving(nextSaving);
  }, []);

  async function goBack() {
    if (dirty && saveRef.current) {
      const ok = await saveRef.current();
      if (!ok) return;
    }
    backOr(scratchListHref(projectId) as never);
  }

  if (!ready) return null;
  if (!user) return <Redirect href="/login" />;
  if (!projectId || !noteId) return <Redirect href="/manuscripts" />;

  return (
    <View style={layout.screen}>
      <AppHeader
        title={t("scratch.noteTitle")}
        onBack={() => void goBack()}
        backAccessibilityLabel={t("scratch.allNotes")}
        actionLabel={saving ? t("common.saving") : dirty ? t("common.save") : t("scratch.saved")}
        onAction={() => void saveRef.current?.()}
        actionDisabled={!dirty || saving}
      />
      <ScratchNoteEditor
        projectId={projectId}
        noteId={noteId}
        saveRef={saveRef}
        onDirtyChange={onDirtyChange}
      />
    </View>
  );
}
