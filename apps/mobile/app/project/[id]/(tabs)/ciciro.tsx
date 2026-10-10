import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useAppHeaderHeight } from "../../../../components/AppHeader";
import { CiciroChat } from "../../../../components/CiciroChat";
import { useTabBarClearance } from "../../../../components/ManuscriptTabBar";
import { OpenQuestionsSheet } from "../../../../components/OpenQuestionsSheet";
import { ProjectLoadError } from "../../../../components/ProjectLoadError";
import { ScreenErrorBoundary } from "../../../../components/ScreenErrorBoundary";
import { SkeletonList } from "../../../../components/Skeleton";
import {
  ciciro,
  queryClient,
  queryKeys,
  useDraftInsertionsQuery,
  useQuestionsQuery,
} from "../../../../lib/api";
import type { OpenQuestion } from "../../../../lib/api/types";
import { insertDraftOps, insertionKey } from "../../../../lib/chat-insert";
import { countWords } from "../../../../lib/manuscript";
import {
  asCiciroIntent,
  asSelectionAction,
  chatRequestFromAnswer,
  chatRequestFromComposer,
  chatRequestFromIntent,
  chatRequestFromSelectionAction,
} from "../../../../lib/ciciro-intents";
import { commentQuote } from "../../../../lib/selection-menu";
import { useProject } from "../../../../lib/project";
import { normalizeKind } from "../../../../lib/manuscript-kind";
import { quickActionsFor, chatRequestFromAction } from "../../../../lib/quick-actions";
import { selectedTextFor } from "../../../../lib/read-aloud";
import { useAppTheme } from "../../../../lib/settings";
import { useCiciroChat } from "../../../../lib/use-ciciro-chat";
import { getAnalytics } from "../../../../lib/analytics-client";

export default function CiciroScreen() {
  return (
    <ScreenErrorBoundary>
      <CiciroScreenContent />
    </ScreenErrorBoundary>
  );
}

function CiciroScreenContent() {
  const { project, loading, error, errorDetail, reload, selectedChapterId, recordChapterOp } = useProject();
  const {
    intent,
    questions: questionsParam,
    prompt: promptParam,
    selectionAction: selectionActionParam,
  } = useLocalSearchParams<{
    intent?: string;
    questions?: string;
    prompt?: string;
    selectionAction?: string;
  }>();
  const router = useRouter();
  const { t } = useTranslation();
  const { layout, colors } = useAppTheme();
  const clearance = useTabBarClearance();
  const headerHeight = useAppHeaderHeight();
  const requested = asCiciroIntent(intent);
  const projectId = project?.id ?? "";
  const chat = useCiciroChat(projectId);
  const insertions = useDraftInsertionsQuery(projectId, { enabled: Boolean(projectId) });
  const questions = useQuestionsQuery(projectId, "open", { enabled: Boolean(projectId) });
  const [composer, setComposer] = useState("");
  const [insertError, setInsertError] = useState<string | null>(null);
  const [localInserted, setLocalInserted] = useState<Set<string>>(new Set());
  const [questionsOpen, setQuestionsOpen] = useState(false);
  const lastIntent = useRef<string | null>(null);
  // The text a Comment from the editor's selection menu is about: it rides along with the typed message.
  const [commentOn, setCommentOn] = useState("");
  const [focusComposerKey, setFocusComposerKey] = useState(0);
  const requestedSelectionAction = asSelectionAction(selectionActionParam);
  const lastSelectionAction = useRef<string | null>(null);

  /** chapterId → its 1-based number, so a question can name where it lands. */
  const chapterNumbers = useMemo(() => {
    const map = new Map<string, number>();
    (project?.chapters ?? []).forEach((chapter, index) => map.set(chapter.id, index + 1));
    return map;
  }, [project?.chapters]);

  const insertedKeys = useMemo(() => {
    const next = new Set(localInserted);
    for (const row of insertions.data ?? []) {
      next.add(insertionKey(row.turnId, row.segmentIndex));
    }
    return next;
  }, [insertions.data, localInserted]);

  const sendComposer = useCallback(() => {
    // The composer stays live while Ciciro answers, so a send that the hook
    // would drop must not take the author's typing with it.
    if (!projectId || chat.streaming) return;
    const input = chatRequestFromComposer(composer, {
      projectId,
      chapterId: selectedChapterId,
      selection: commentOn,
    });
    if (!input) return;
    getAnalytics().track("chat_message_sent", {});
    const typed = composer;
    setComposer("");
    setCommentOn("");
    void chat.send(input).then((failure) => {
      // The allowance is used up: the server kept nothing, so give the author
      // their words back rather than make them type it again next month.
      if (failure?.code === "aiLimit") setComposer((current) => current || typed);
    });
  }, [chat.send, chat.streaming, commentOn, composer, projectId, selectedChapterId]);

  const answerQuestion = useCallback(
    (question: OpenQuestion, answer: string) => {
      if (!projectId) return;
      const input = chatRequestFromAnswer(question, answer, {
        projectId,
        chapterId: question.chapterId ?? selectedChapterId,
      });
      if (!input) return;
      void chat.send(input);
    },
    [chat.send, projectId, selectedChapterId]
  );

  const kind = normalizeKind(project?.kind);
  const quickActions = useMemo(
    () => quickActionsFor(kind).map((action) => ({ id: action.id, label: t(`quickActions.${action.id}`) })),
    [kind, t]
  );

  const runQuickAction = useCallback(
    (id: string) => {
      const action = quickActionsFor(kind).find((item) => item.id === id);
      if (!action || !projectId || chat.streaming) return;
      if (action.writes && chat.editMode === "chat") {
        Alert.alert(t("quickActions.editsOffTitle"), t("quickActions.editsOffBody"));
        return;
      }
      const selection = selectedChapterId ? selectedTextFor(selectedChapterId) : "";
      if (action.scope === "selection" && !selection.trim()) {
        Alert.alert(t("quickActions.selectFirstTitle"), t("quickActions.selectFirstBody"));
        return;
      }
      getAnalytics().track("quick_action_used", { action: action.id, kind });
      void chat.send(chatRequestFromAction(action, { projectId, chapterId: selectedChapterId, selection }));
    },
    [chat.editMode, chat.send, chat.streaming, kind, projectId, selectedChapterId, t]
  );

  const insertDraft = useCallback(
    (text: string, turnId: string | null, index: number) => {
      const chapter = project?.chapters.find((item) => item.id === selectedChapterId);
      if (!chapter) {
        setInsertError(t("ciciroTab.insertError"));
        return;
      }
      const ops = insertDraftOps(chapter, text, kind);
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
            wordCount: countWords(text),
          })
          .then(() => {
            void queryClient.invalidateQueries({
              queryKey: queryKeys.chat.insertions(chapter.projectId),
            });
          })
          .catch(() => {});
      }
    },
    [kind, project, recordChapterOp, selectedChapterId, t]
  );

  // Arriving from the tab bar's Questions action opens the sheet once.
  useEffect(() => {
    if (!questionsParam) return;
    setQuestionsOpen(true);
    router.setParams({ questions: undefined });
  }, [questionsParam, router]);

  // A stuck prompt from the editor lands in the composer for the author to send.
  useEffect(() => {
    const prompt = Array.isArray(promptParam) ? promptParam[0] : promptParam;
    if (!prompt) return;
    setComposer(prompt);
    router.setParams({ prompt: undefined });
  }, [promptParam, router]);

  useEffect(() => {
    if (!requested) {
      lastIntent.current = null;
      return;
    }
    if (!projectId || chat.loading || chat.streaming) return;
    if ((project?.chapters.length ?? 0) > 0 && !selectedChapterId) return;
    if (lastIntent.current === requested) return;
    lastIntent.current = requested;
    getAnalytics().track("quick_action_used", { action: requested, kind: "chat" });
    void chat.send(
      chatRequestFromIntent(requested, {
        projectId,
        chapterId: selectedChapterId,
        selection: selectedChapterId ? selectedTextFor(selectedChapterId) : "",
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

  // A selection-menu button from the editor: Comment starts a message about the highlighted text, the others
  // send their brief for it right away (the same turn the web's menu sends).
  useEffect(() => {
    if (!requestedSelectionAction) {
      lastSelectionAction.current = null;
      return;
    }
    if (!projectId || chat.loading) return;
    if ((project?.chapters.length ?? 0) > 0 && !selectedChapterId) return;
    if (lastSelectionAction.current === requestedSelectionAction) return;
    const selection = selectedChapterId ? selectedTextFor(selectedChapterId) : "";
    if (requestedSelectionAction === "comment") {
      lastSelectionAction.current = requestedSelectionAction;
      if (selection.trim()) {
        setComposer(commentQuote(selection));
        setCommentOn(selection);
        setFocusComposerKey((key) => key + 1);
      }
      router.setParams({ selectionAction: undefined });
      return;
    }
    if (chat.streaming) return;
    lastSelectionAction.current = requestedSelectionAction;
    const input = chatRequestFromSelectionAction(requestedSelectionAction, {
      projectId,
      chapterId: selectedChapterId,
      selection,
      kind,
    });
    if (input) void chat.send(input);
    else Alert.alert(t("quickActions.selectFirstTitle"), t("quickActions.selectFirstBody"));
    router.setParams({ selectionAction: undefined });
  }, [
    chat.loading,
    chat.send,
    chat.streaming,
    kind,
    project,
    projectId,
    requestedSelectionAction,
    router,
    selectedChapterId,
    t,
  ]);

  if (loading && !project) {
    return (
      <View style={[layout.padded, { paddingTop: headerHeight + 8 }]}>
        <SkeletonList count={4} accessibilityLabel={t("common.loading")} />
      </View>
    );
  }

  if (error) {
    return <ProjectLoadError message={error} detail={errorDetail} reload={reload} />;
  }

  if (!project) return null;

  return (
    <View style={layout.screen}>
      {requested ? (
        <View
          style={{
            marginHorizontal: 20,
            marginTop: headerHeight + 8,
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
        failure={chat.failure}
        insertError={insertError}
        phase={chat.stream.status}
        composer={composer}
        onComposerChange={(value) => {
          setComposer(value);
          if (!value.trim()) setCommentOn("");
        }}
        focusComposerKey={focusComposerKey}
        onSend={sendComposer}
        onStop={chat.stop}
        onRetry={() => void chat.retry()}
        onClear={async () => {
          setLocalInserted(new Set());
          return chat.clear();
        }}
        onUndoClear={(token) => void chat.undoClear(token)}
        editMode={chat.editMode}
        onEditModeChange={chat.setEditMode}
        onInsertDraft={insertDraft}
        insertedKeys={insertedKeys}
        openQuestionCount={questions.data?.length ?? 0}
        onOpenQuestions={() => setQuestionsOpen(true)}
        quickActions={quickActions}
        onQuickAction={runQuickAction}
        bottomInset={clearance}
        // The requested-intent card already clears the header.
        topInset={requested ? 0 : headerHeight}
      />
      <OpenQuestionsSheet
        projectId={projectId}
        visible={questionsOpen}
        onClose={() => setQuestionsOpen(false)}
        onAnswer={answerQuestion}
        chapterNumbers={chapterNumbers}
      />
    </View>
  );
}
