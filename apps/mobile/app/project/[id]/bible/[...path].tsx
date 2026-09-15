import { useCallback, useRef, useState } from "react";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { AppHeader } from "../../../../components/AppHeader";
import { StoryBibleEditor } from "../../../../components/StoryBibleEditor";
import { bibleFileLabel, biblePathFromParam } from "../../../../lib/bible-files";
import { useAppTheme } from "../../../../lib/settings";
import { useSession } from "../../../../lib/session";

export default function StoryBibleFileScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { id, path: pathParam } = useLocalSearchParams<{ id: string; path?: string | string[] }>();
  const { user, ready } = useSession();
  const { layout } = useAppTheme();
  const projectId = typeof id === "string" ? id : "";
  const path = biblePathFromParam(pathParam);
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
    if (router.canGoBack()) router.back();
    else router.navigate(`/project/${projectId}/bible`);
  }

  if (!ready) return null;
  if (!user) return <Redirect href="/login" />;
  if (!projectId || !path) return <Redirect href="/manuscripts" />;

  return (
    <View style={layout.screen}>
      <AppHeader
        title={bibleFileLabel(path)}
        onBack={() => void goBack()}
        backAccessibilityLabel={t("bible.allFiles")}
        actionLabel={saving ? t("common.saving") : dirty ? t("common.save") : t("bible.saved")}
        onAction={() => void saveRef.current?.()}
        actionDisabled={!dirty || saving}
      />
      <StoryBibleEditor
        projectId={projectId}
        path={path}
        saveRef={saveRef}
        onDirtyChange={onDirtyChange}
      />
    </View>
  );
}
