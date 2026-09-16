import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { ApiError } from "../lib/api/client";
import { useBibleFileQuery, useWriteBibleMutation } from "../lib/api";
import { useOptionalAppTheme } from "../lib/settings";
import { colors as parchmentColors, layout as parchmentLayout } from "../lib/theme";
import { useReduceMotion } from "../lib/use-reduce-motion";
import { SkeletonList } from "./Skeleton";

export function StoryBibleEditor({
  projectId,
  path,
  onDirtyChange,
  saveRef,
}: {
  projectId: string;
  path: string;
  onDirtyChange?: (dirty: boolean, saving: boolean) => void;
  saveRef?: MutableRefObject<(() => Promise<boolean>) | null>;
}) {
  const { t } = useTranslation();
  const themed = useOptionalAppTheme();
  const layout = themed?.layout ?? parchmentLayout;
  const colors = themed?.colors ?? parchmentColors;
  const autoCorrect = themed?.settings.autoCorrect ?? true;
  const reduceMotion = useReduceMotion();
  const file = useBibleFileQuery(projectId, path, { enabled: Boolean(path) });
  const write = useWriteBibleMutation();
  const [content, setContent] = useState("");
  const [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedPath = useRef<string | null>(null);

  useEffect(() => {
    loadedPath.current = null;
    setContent("");
    setDirty(false);
    setError(null);
  }, [path]);

  useEffect(() => {
    if (!path || !file.data || file.data.path !== path) return;
    if (loadedPath.current === path) return;
    loadedPath.current = path;
    setContent(file.data.content);
    setRevision(file.data.revision ?? 0);
    setDirty(false);
  }, [path, file.data]);

  const save = useCallback(async () => {
    if (!path || !dirty) return true;
    setError(null);
    try {
      const result = await write.mutateAsync({
        projectId,
        path,
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
  }, [content, dirty, path, projectId, revision, t, write]);

  useEffect(() => {
    if (saveRef) saveRef.current = save;
    onDirtyChange?.(dirty, write.isPending);
  }, [dirty, onDirtyChange, save, saveRef, write.isPending]);

  if (file.isPending && !file.data) {
    return (
      <View style={layout.padded}>
        <SkeletonList count={5} accessibilityLabel={t("common.loading")} />
      </View>
    );
  }

  if (file.isError && !file.data) {
    return (
      <View style={layout.padded}>
        <Text style={layout.error} role="alert">
          {t("bible.loadError")}
        </Text>
      </View>
    );
  }

  return (
    <KeyboardAwareScrollView
      testID="bible-editor"
      style={layout.screen}
      contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 20, paddingBottom: 24 }}
      keyboardShouldPersistTaps="handled"
      bottomOffset={24}
    >
      <Animated.View
        entering={reduceMotion ? undefined : FadeInDown.duration(260)}
        style={{ flexGrow: 1 }}
      >
        {error ? (
          <Text style={[layout.error, { marginTop: 0, marginBottom: 12 }]} role="alert">
            {error}
          </Text>
        ) : null}
        <Text style={[layout.cardMeta, { marginBottom: 8 }]}>{path}</Text>
        <TextInput
          style={{
            flexGrow: 1,
            minHeight: 240,
            backgroundColor: colors.panel,
            borderColor: colors.line,
            borderWidth: 1,
            borderRadius: 10,
            paddingHorizontal: 14,
            paddingVertical: 12,
            fontSize: 15,
            lineHeight: 22,
            color: colors.ink,
            fontFamily: "Menlo",
            textAlignVertical: "top",
          }}
          accessibilityLabel={path}
          value={content}
          onChangeText={(next) => {
            setContent(next);
            setDirty(true);
          }}
          multiline
          scrollEnabled={false}
          autoCorrect={autoCorrect}
          spellCheck={autoCorrect}
        />
      </Animated.View>
    </KeyboardAwareScrollView>
  );
}
