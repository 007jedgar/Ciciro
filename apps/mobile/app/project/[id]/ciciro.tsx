import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { CiciroChat } from "../../../components/CiciroChat";
import { useTabBarClearance } from "../../../components/ManuscriptTabBar";
import { SkeletonList } from "../../../components/Skeleton";
import { ciciro, queryClient, queryKeys, useDraftInsertionsQuery } from "../../../lib/api";
import { insertDraftOps, insertionKey } from "../../../lib/chat-insert";
import { asCiciroIntent, chatRequestFromComposer, chatRequestFromIntent } from "../../../lib/ciciro-intents";
import { useProject } from "../../../lib/project";
import { useAppTheme } from "../../../lib/settings";
import { useCiciroChat } from "../../../lib/use-ciciro-chat";

export default function CiciroScreen() {
  const { project, loading, error, selectedChapterId, recordChapterOp } = useProject();
  const { intent } = useLocalSearchParams<{ intent?: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const { layout, colors } = useAppTheme();
  const clearance = useTabBarClearance();
  const requested = asCiciroIntent(intent);
  const projectId = project?.id ?? "";
  const chat = useCiciroChat(projectId);
  const insertions = useDraftInsertionsQuery(projectId, { enabled: Boolean(projectId) });
  const [composer, setComposer] = useState("");
  const [insertError, setInsertError] = useState<string | null>(null);
  const [localInserted, setLocalInserted] = useState<Set<string>>(new Set());
  const lastIntent = useRef<string | null>(null);

  const insertedKeys = useMemo(() => {
    const next = new Set(localInserted);
    for (const row of insertions.data ?? []) {
      next.add(insertionKey(row.turnId, row.segmentIndex));
    }
    return next;
  }, [insertions.data, localInserted]);

  const sendComposer = useCallback(() => {
    if (!projectId) return;
    const input = chatRequestFromComposer(composer, {
      projectId,
      chapterId: selectedChapterId,
    });
    if (!input) return;
    setComposer("");
    void chat.send(input);
  }, [chat.send, composer, projectId, selectedChapterId]);

  const insertDraft = useCallback(
    (text: string, turnId: string | null, index: number) => {
      const chapter = project?.chapters.find((item) => item.id === selectedChapterId);
      if (!chapter) {
        setInsertError(t("ciciroTab.insertError"));
        return;
      }
      const ops = insertDraftOps(chapter, text);
      if (ops.length === 0) return;
      setInsertError(null);
      void recordChapterOp(ops);
      if (turnId) {
        const key = insertionKey(turnId, index);
        setLocalInserted((current) => new Set(current).add(key));
        void ciciro.chat.insertions
          .record({
            projectId: chapter.projectId,
            turnId,
            segmentIndex: index,
            chapterId: chapter.id,
          })
          .then(() => {
            void queryClient.invalidateQueries({
              queryKey: queryKeys.chat.insertions(chapter.projectId),
            });
          })
          .catch(() => {});
      }
    },
    [project, recordChapterOp, selectedChapterId, t]
  );

  useEffect(() => {
    if (!requested) {
      lastIntent.current = null;
      return;
    }
    if (!projectId || chat.loading || chat.streaming) return;
    if ((project?.chapters.length ?? 0) > 0 && !selectedChapterId) return;
    if (lastIntent.current === requested) return;
    lastIntent.current = requested;
    void chat.send(
      chatRequestFromIntent(requested, {
        projectId,
        chapterId: selectedChapterId,
      })
    );
    router.setParams({ intent: undefined });
  }, [
    chat.loading,
    chat.send,
    chat.streaming,
    project,
    projectId,
    requested,
    router,
    selectedChapterId,
  ]);

  if (loading && !project) {
    return (
      <View style={[layout.padded, { paddingTop: 8 }]}>
        <SkeletonList count={4} accessibilityLabel={t("common.loading")} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={layout.padded}>
        <Text style={layout.error}>{error}</Text>
      </View>
    );
  }

  if (!project) return null;

  return (
    <View style={layout.screen}>
      {requested ? (
        <View
          style={{
            marginHorizontal: 20,
            marginTop: 8,
            paddingVertical: 10,
            paddingHorizontal: 14,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: colors.line,
            backgroundColor: colors.accentSoft,
          }}
        >
          <Text style={{ color: colors.inkSoft, fontSize: 12, marginBottom: 2 }}>
            {t("ciciroTab.requested")}
          </Text>
          <Text style={{ color: colors.ink, fontSize: 15, fontWeight: "600" }}>
            {t(`ciciroTab.intent.${requested}`)}
          </Text>
        </View>
      ) : null}
      <CiciroChat
        messages={chat.messages}
        stream={chat.stream}
        streaming={chat.streaming}
        error={insertError ?? chat.error}
        phase={chat.stream.status}
        composer={composer}
        onComposerChange={setComposer}
        onSend={sendComposer}
        onClear={() => {
          setLocalInserted(new Set());
          void chat.clear();
        }}
        onInsertDraft={insertDraft}
        insertedKeys={insertedKeys}
        bottomInset={clearance}
      />
    </View>
  );
}
