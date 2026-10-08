import { useEffect, useRef, useState } from "react";
import { FlatList, RefreshControl, Text, View } from "react-native";
import Animated, { FadeIn, LinearTransition, SlideInRight, SlideOutLeft } from "react-native-reanimated";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useAppHeaderHeight } from "../../../../components/AppHeader";
import { ChapterListCard } from "../../../../components/ChapterListCard";
import { PressableCard } from "../../../../components/PressableCard";
import { ProjectTools, type ProjectTool } from "../../../../components/ProjectTools";
import {
  BookIcon,
  CommentIcon,
  HeadphonesIcon,
  HistoryIcon,
  ImportIcon,
  InfoIcon,
  OutlineIcon,
  PencilIcon,
  SearchIcon,
  TimerIcon,
} from "../../../../components/icons";
import { ExportCard } from "../../../../components/ExportCard";
import { PreviouslyOnCard } from "../../../../components/PreviouslyOnCard";
import { Kicker } from "../../../../components/Kicker";
import { ScreenErrorBoundary } from "../../../../components/ScreenErrorBoundary";
import { ScreenErrorState } from "../../../../components/ScreenErrorState";
import { SlideDownIn } from "../../../../components/SlideDownIn";
import { ManuscriptTag } from "../../../../components/ManuscriptTag";
import { useTabBarClearance } from "../../../../components/ManuscriptTabBar";
import { SkeletonList } from "../../../../components/Skeleton";
import { UndoSnackbar } from "../../../../components/UndoSnackbar";
import {
  ApiError,
  queryClient,
  queryKeys,
  useDeleteChapterMutation,
  usePatchChapterMutation,
  usePatchProjectMutation,
  useShareCommentsQuery,
  useWeeklyReviewsQuery,
} from "../../../../lib/api";
import { bibleIndexHref } from "../../../../lib/bible-files";
import { outlineHref } from "../../../../lib/outline";
import { requestChapterDelete } from "../../../../lib/chapter-delete";
import { useUndoableRemoval } from "../../../../lib/undo-removal";
import { useReduceMotion } from "../../../../lib/use-reduce-motion";
import { importManuscriptFile, isImportable, pickImportFile } from "../../../../lib/import";
import { useProject } from "../../../../lib/project";
import { scratchListHref } from "../../../../lib/scratch";
import { betaReadersHref } from "../../../../lib/shares";
import { openTodayEntry } from "../../../../lib/journal";
import { normalizeKind } from "../../../../lib/manuscript-kind";
import { weeklyReviewHref } from "../../../../lib/weekly-review";
import { useAppTheme } from "../../../../lib/settings";
import {
  CHAPTERS_SLIDE_DELAY_MS,
  LIST_EDGE_SLACK,
  TOOL_POP_STAGGER_MS,
} from "../../../../lib/chapters-intro";
import {
  consumeNewManuscriptArrival,
  isNewManuscriptArrival,
} from "../../../../lib/new-manuscript-arrival";
import type { Chapter, ProjectDetail } from "../../../../lib/types";
import type { ChapterStatus } from "../../../../lib/chapter-status";
import { AlertText } from "../../../../components/AlertText";

export default function ChaptersScreen() {
  return (
    <ScreenErrorBoundary>
      <ChaptersScreenContent />
    </ScreenErrorBoundary>
  );
}

function ChaptersScreenContent() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const {
    project,
    loading,
    error,
    errorDetail,
    reload,
    selectedChapterId,
    setSelectedChapterId,
    flushEdits,
    addChapter,
  } = useProject();
  const { t } = useTranslation();
  const { layout, colors } = useAppTheme();
  const clearance = useTabBarClearance();
  const headerHeight = useAppHeaderHeight();
  const removeChapter = useDeleteChapterMutation();
  const patchProject = usePatchProjectMutation();
  const patchChapter = usePatchChapterMutation();
  const openReaderComments = useShareCommentsQuery(typeof id === "string" ? id : "", "open");
  const weeklyReviews = useWeeklyReviewsQuery(typeof id === "string" ? id : "");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [tagError, setTagError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryAttempted, setRetryAttempted] = useState(false);
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    if (!error) setRetryAttempted(false);
  }, [error]);

  function pullToRefresh() {
    setPulling(true);
    void reload().finally(() => setPulling(false));
  }

  async function retry() {
    setRetrying(true);
    const loaded = await reload();
    setRetrying(false);
    setRetryAttempted(!loaded);
  }
  // Whether the user has just created this manuscript and landed here: only that
  // first arrival slides the list down, not every later visit.
  const arriving = useRef(isNewManuscriptArrival(typeof id === "string" ? id : "")).current;
  const loaded = Boolean(project);
  useEffect(() => {
    if (arriving && loaded && typeof id === "string") consumeNewManuscriptArrival(id);
  }, [arriving, loaded, id]);
  const listRef = useRef<FlatList<Chapter>>(null);
  // Chapters the list has already shown, so only ones added later slide in.
  const seenIds = useRef<Set<string> | null>(null);
  const restoredIds = useRef<Set<string>>(new Set());
  const { hidden, notice, remove: removeWithUndo, undo } = useUndoableRemoval({
    onFailed: (_id, err) => setDeleteError(err instanceof ApiError ? err.message : t("chapters.deleteError")),
  });

  const chapters = (project?.chapters ?? []).filter((c) => !hidden.has(c.id));
  if (seenIds.current === null && project) seenIds.current = new Set(chapters.map((c) => c.id));
  const freshIds = new Set(
    chapters.filter((c) => seenIds.current !== null && !seenIds.current.has(c.id)).map((c) => c.id)
  );
  const freshKey = [...freshIds].join(",");

  useEffect(() => {
    if (!freshKey || !seenIds.current) return;
    for (const id of freshKey.split(",")) seenIds.current.add(id);
    // A new chapter lands at the end of a long list: bring it into view.
    const timer = setTimeout(() => listRef.current?.scrollToEnd({ animated: !reduceMotion }), 60);
    return () => clearTimeout(timer);
  }, [freshKey, reduceMotion]);

  if (loading && !project) {
    return (
      <View style={[layout.padded, { paddingTop: headerHeight + 8 }]}>
        <SkeletonList count={6} accessibilityLabel={t("common.loading")} />
      </View>
    );
  }

  const kind = normalizeKind(project?.kind);
  const projectId = typeof id === "string" ? id : "";

  function requestDelete(chapter: Chapter) {
    requestChapterDelete(
      chapter,
      {
        blockedTitle: t("chapters.deleteBlockedTitle"),
        blockedMessage: t("chapters.deleteBlockedMessage"),
        cancel: t("common.cancel"),
      },
      () => {
        if (!projectId) return;
        setDeleteError(null);
        removeWithUndo(chapter.id, t("chapters.removed"), () =>
          removeChapter.mutateAsync({ id: chapter.id, projectId })
        );
      }
    );
  }

  function undoRemoval() {
    if (notice) restoredIds.current.add(notice.id);
    undo();
  }

  async function importChapters() {
    if (!projectId || importing) return;
    setDeleteError(null);
    // Busy from the press, not from the upload: the system picker takes a beat
    // to appear and the card has to say something is happening until it does.
    setImporting(true);
    try {
      const file = await pickImportFile();
      if (!file) return;
      if (!isImportable(file.name)) {
        setDeleteError(t("importFile.unsupported"));
        return;
      }
      await importManuscriptFile(file, { projectId });
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : t("importFile.error"));
    } finally {
      setImporting(false);
    }
  }

  async function startToday() {
    setDeleteError(null);
    try {
      await openTodayEntry(chapters, (title) => addChapter(title), setSelectedChapterId);
      if (projectId) router.navigate(`/project/${projectId}/manuscript`);
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : t("chapters.addError"));
    }
  }

  async function saveGenre(genre: string) {
    if (!project) return;
    setTagError(null);
    try {
      await patchProject.mutateAsync({ id: project.id, body: { genre } });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t("manuscriptTag.saveError");
      setTagError(message);
      throw err instanceof Error ? err : new Error(message);
    }
  }

  async function saveStatus(chapter: Chapter, status: ChapterStatus) {
    if (!projectId) return;
    setDeleteError(null);
    queryClient.setQueryData<ProjectDetail>(queryKeys.projects.detail(projectId), (current) => {
      if (!current) return current;
      return {
        ...current,
        chapters: current.chapters.map((item) => (item.id === chapter.id ? { ...item, status } : item)),
      };
    });
    try {
      await patchChapter.mutateAsync({
        id: chapter.id,
        body: { expectedRevision: chapter.revision, status },
      });
    } catch (err) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) });
      setDeleteError(err instanceof ApiError ? err.message : t("chapters.statusError"));
    }
  }

  const tools: ProjectTool[] = [
    {
      key: "bible",
      label: t("bible.title"),
      icon: <BookIcon color={colors.accent} />,
      onPress: () => router.push(bibleIndexHref(projectId) as never),
    },
    {
      key: "outline",
      label: t("outline.title"),
      icon: <OutlineIcon color={colors.accent} />,
      onPress: () => router.push(outlineHref(projectId) as never),
    },
    {
      key: "search",
      label: t("search.title"),
      icon: <SearchIcon color={colors.accent} />,
      onPress: () => router.push(`/project/${projectId}/search` as never),
    },
    {
      key: "scratch",
      label: t("scratch.title"),
      icon: <PencilIcon color={colors.accent} size={24} />,
      onPress: () => router.push(scratchListHref(projectId) as never),
    },
    {
      key: "sprint",
      label: t("sprint.title"),
      icon: <TimerIcon color={colors.accent} />,
      onPress: () => router.push(`/project/${projectId}/sprint` as never),
    },
    {
      key: "listen",
      label: t("readAloud.title"),
      icon: <HeadphonesIcon color={colors.accent} size={24} />,
      onPress: () => router.push(`/project/${projectId}/listen` as never),
    },
    {
      key: "weekly",
      label: t("weekly.title"),
      icon: <HistoryIcon color={colors.accent} />,
      badge: weeklyReviews.data?.due ? "" : null,
      a11yLabel: weeklyReviews.data?.due ? `${t("weekly.title")}. ${t("weekly.cardDue")}` : undefined,
      onPress: () => router.push(weeklyReviewHref(projectId) as never),
    },
    {
      key: "beta",
      label: t("beta.title"),
      icon: <CommentIcon color={colors.accent} />,
      badge: openReaderComments.data?.length ? String(openReaderComments.data.length) : null,
      a11yLabel: openReaderComments.data?.length
        ? `${t("beta.title")}. ${t("beta.cardOpen", { count: openReaderComments.data.length })}`
        : undefined,
      onPress: () => router.push(betaReadersHref(projectId) as never),
    },
    {
      key: "import",
      label: importing ? t("importFile.importing") : t("importFile.chaptersCard"),
      a11yLabel: t("importFile.chaptersCard"),
      icon: <ImportIcon color={colors.accent} />,
      busy: importing,
      onPress: () => void importChapters(),
    },
    {
      key: "details",
      label: t("details.title"),
      icon: <InfoIcon color={colors.accent} size={24} />,
      onPress: () => router.push(`/project/${projectId}/details` as never),
    },
  ];

  // A banner (a delete error, or a background load error with chapters still
  // to show) already clears the header, so the list starts right under it; a
  // load error with nothing to show instead renders inside the list as its
  // empty state, which still needs the inset since nothing pushed the flow
  // down for it.
  const showInlineBanner = Boolean(deleteError) || Boolean(error && project);
  const listTop = showInlineBanner ? 0 : headerHeight + 16;

  return (
    <View style={[layout.padded, { paddingTop: 0, paddingHorizontal: layout.padded.paddingHorizontal - LIST_EDGE_SLACK }]}>
      {deleteError ? (
        <AlertText
          style={[
            layout.error,
            { marginTop: headerHeight + 16, marginBottom: 12, marginHorizontal: LIST_EDGE_SLACK },
          ]}
          role="alert"
        >
          {deleteError}
        </AlertText>
      ) : null}
      {error && project ? (
        <ScreenErrorState
          variant="inline"
          message={error}
          detail={errorDetail}
          onRetry={() => void retry()}
          retrying={retrying}
          showRestart={retryAttempted}
          style={{
            marginTop: deleteError ? 8 : headerHeight + 16,
            marginBottom: 12,
            marginHorizontal: LIST_EDGE_SLACK,
          }}
        />
      ) : null}
      <SlideDownIn enabled={arriving} delay={CHAPTERS_SLIDE_DELAY_MS}>
        <Animated.FlatList
          ref={listRef}
          data={chapters}
          itemLayoutAnimation={reduceMotion ? undefined : LinearTransition.duration(200)}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          scrollIndicatorInsets={{ top: listTop }}
          // Horizontal padding moved in from the screen edge (see LIST_EDGE_SLACK)
          // so the list's own clip frame has headroom beyond where content rests.
          contentContainerStyle={{
            paddingTop: listTop,
            paddingBottom: clearance,
            paddingHorizontal: LIST_EDGE_SLACK,
          }}
          refreshControl={
            <RefreshControl
              refreshing={pulling}
              onRefresh={pullToRefresh}
              tintColor={colors.accent}
              progressViewOffset={listTop}
            />
          }
          ListHeaderComponent={
            project ? (
              <View>
                <PreviouslyOnCard projectId={projectId} />
                {kind === "blog" && project.logline ? (
                  <Text style={[layout.body, { fontStyle: "italic", marginBottom: 12 }]}>
                    {project.logline}
                  </Text>
                ) : null}
                {kind !== "journal" ? (
                  <ManuscriptTag
                    genre={project.genre}
                    busy={patchProject.isPending}
                    error={tagError}
                    onSave={saveGenre}
                  />
                ) : null}
                {kind === "journal" ? (
                  <PressableCard
                    style={[layout.card, { marginBottom: 16 }]}
                    onPress={() => void startToday()}
                    accessibilityRole="button"
                    accessibilityLabel={t("kinds.todayEntry")}
                  >
                    <Text style={layout.cardTitle}>{t("kinds.todayEntry")}</Text>
                    <Text style={layout.cardMeta}>{t("kinds.todayEntryMeta")}</Text>
                  </PressableCard>
                ) : null}
                <Kicker label={t("chapters.toolsKicker")} count={`${tools.length}`} />
                <ProjectTools
                  tools={tools}
                  // On a new manuscript the tiles wait for the list to start sliding down.
                  introDelay={arriving ? CHAPTERS_SLIDE_DELAY_MS + TOOL_POP_STAGGER_MS * 2 : 0}
                />
                <Kicker
                  label={t("chapters.kicker")}
                  count={t("chapters.entries", { count: chapters.length })}
                />
              </View>
            ) : null
          }
          ListFooterComponent={project ? <ExportCard projectId={projectId} flushEdits={flushEdits} /> : null}
          ListEmptyComponent={
            error && !project ? (
              <ScreenErrorState
                variant="full"
                message={error}
                detail={errorDetail}
                onRetry={() => void retry()}
                retrying={retrying}
                showRestart={retryAttempted}
                style={{ marginTop: 16 }}
              />
            ) : (
              <Text style={layout.body}>{t("chapters.empty")}</Text>
            )
          }
          renderItem={({ item, index }) => (
            <Animated.View
              entering={
                reduceMotion
                  ? undefined
                  : freshIds.has(item.id)
                    ? SlideInRight.duration(260)
                    : restoredIds.current.has(item.id)
                      ? FadeIn.duration(200)
                      : undefined
              }
              exiting={reduceMotion ? undefined : SlideOutLeft.duration(200)}
            >
              <ChapterListCard
                chapter={item}
                number={index + 1}
                kind={kind}
                selected={item.id === selectedChapterId}
                onOpen={() => {
                  setSelectedChapterId(item.id);
                  if (projectId) router.navigate(`/project/${projectId}/manuscript`);
                }}
                onRequestDelete={() => requestDelete(item)}
                onStatusChange={(status) => {
                  void saveStatus(item, status);
                }}
                onOpenHistory={
                  projectId
                    ? () => router.push(`/project/${projectId}/history/${item.id}` as never)
                    : undefined
                }
              />
            </Animated.View>
          )}
        />
      </SlideDownIn>
      <UndoSnackbar message={notice?.message ?? null} onUndo={undoRemoval} bottom={clearance - 12} />
    </View>
  );
}