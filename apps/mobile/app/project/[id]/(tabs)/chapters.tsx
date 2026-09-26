import { useState } from "react";
import { FlatList, Text, View } from "react-native";
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
  OutlineIcon,
  PencilIcon,
  SearchIcon,
  TimerIcon,
} from "../../../../components/icons";
import { ExportCard } from "../../../../components/ExportCard";
import { PreviouslyOnCard } from "../../../../components/PreviouslyOnCard";
import { ManuscriptTag } from "../../../../components/ManuscriptTag";
import { useTabBarClearance } from "../../../../components/ManuscriptTabBar";
import { SkeletonList } from "../../../../components/Skeleton";
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
import { confirmChapterDelete } from "../../../../lib/chapter-delete";
import { importManuscriptFile, isImportable, pickImportFile } from "../../../../lib/import";
import { useProject } from "../../../../lib/project";
import { scratchListHref } from "../../../../lib/scratch";
import { betaReadersHref } from "../../../../lib/shares";
import { openTodayEntry } from "../../../../lib/journal";
import { normalizeKind } from "../../../../lib/manuscript-kind";
import { weeklyReviewHref } from "../../../../lib/weekly-review";
import { useAppTheme } from "../../../../lib/settings";
import type { Chapter, ProjectDetail } from "../../../../lib/types";
import type { ChapterStatus } from "../../../../lib/chapter-status";

export default function ChaptersScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { project, loading, error, selectedChapterId, setSelectedChapterId, flushEdits, addChapter } =
    useProject();
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
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  if (loading && !project) {
    return (
      <View style={[layout.padded, { paddingTop: headerHeight + 8 }]}>
        <SkeletonList count={6} accessibilityLabel={t("common.loading")} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[layout.padded, { paddingTop: headerHeight + 16 }]}>
        <Text style={layout.error}>{error}</Text>
      </View>
    );
  }

  const chapters = project?.chapters ?? [];
  const kind = normalizeKind(project?.kind);
  const projectId = typeof id === "string" ? id : "";

  function requestDelete(chapter: Chapter) {
    const title = chapter.title || t("chapters.newTitle");
    confirmChapterDelete(
      chapter,
      {
        blockedTitle: t("chapters.deleteBlockedTitle"),
        blockedMessage: t("chapters.deleteBlockedMessage"),
        deleteTitle: t("chapters.deleteTitle", { title }),
        deleteMessage: t("chapters.deleteMessage"),
        cancel: t("common.cancel"),
        delete: t("common.delete"),
      },
      () => {
        void runDelete(chapter.id);
      }
    );
  }

  async function runDelete(chapterId: string) {
    if (!projectId) return;
    setDeleteError(null);
    setPendingId(chapterId);
    try {
      await removeChapter.mutateAsync({ id: chapterId, projectId });
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : t("chapters.deleteError"));
    } finally {
      setPendingId(null);
    }
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
      key: "sprint",
      label: t("sprint.title"),
      icon: <TimerIcon color={colors.accent} />,
      onPress: () => router.push(`/project/${projectId}/sprint` as never),
    },
    {
      key: "bible",
      label: t("bible.title"),
      icon: <BookIcon color={colors.accent} />,
      onPress: () => router.push(bibleIndexHref(projectId) as never),
    },
    {
      key: "scratch",
      label: t("scratch.title"),
      icon: <PencilIcon color={colors.accent} size={24} />,
      onPress: () => router.push(scratchListHref(projectId) as never),
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
      key: "search",
      label: t("search.title"),
      icon: <SearchIcon color={colors.accent} />,
      onPress: () => router.push(`/project/${projectId}/search` as never),
    },
    {
      key: "outline",
      label: t("outline.title"),
      icon: <OutlineIcon color={colors.accent} />,
      onPress: () => router.push(outlineHref(projectId) as never),
    },
    {
      key: "listen",
      label: t("readAloud.title"),
      icon: <HeadphonesIcon color={colors.accent} size={24} />,
      onPress: () => router.push(`/project/${projectId}/listen` as never),
    },
    {
      key: "import",
      label: importing ? t("importFile.importing") : t("importFile.chaptersCard"),
      a11yLabel: t("importFile.chaptersCard"),
      icon: <ImportIcon color={colors.accent} />,
      busy: importing,
      onPress: () => void importChapters(),
    },
  ];

  return (
    <View style={[layout.padded, { paddingTop: 0 }]}>
      {deleteError ? (
        <Text
          style={[layout.error, { marginTop: headerHeight + 16, marginBottom: 12 }]}
          role="alert"
        >
          {deleteError}
        </Text>
      ) : null}
      <FlatList
        data={chapters}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        // An error line already clears the header, so the list starts under it.
        contentContainerStyle={{
          paddingTop: deleteError ? 0 : headerHeight + 16,
          paddingBottom: clearance,
        }}
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
              <ProjectTools tools={tools} />
            </View>
          ) : null
        }
        ListFooterComponent={project ? <ExportCard projectId={projectId} flushEdits={flushEdits} /> : null}
        ListEmptyComponent={<Text style={layout.body}>{t("chapters.empty")}</Text>}
        renderItem={({ item, index }) => (
          <ChapterListCard
            chapter={item}
            number={index + 1}
            kind={kind}
            selected={item.id === selectedChapterId}
            deleting={pendingId === item.id}
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
        )}
      />
    </View>
  );
}