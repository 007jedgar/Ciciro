import { useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useAppHeaderHeight } from "../../../../components/AppHeader";
import { ChapterListCard } from "../../../../components/ChapterListCard";
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
} from "../../../../lib/api";
import { bibleIndexHref } from "../../../../lib/bible-files";
import { confirmChapterDelete } from "../../../../lib/chapter-delete";
import { useProject } from "../../../../lib/project";
import { useAppTheme } from "../../../../lib/settings";
import type { Chapter, ProjectDetail } from "../../../../lib/types";
import type { ChapterStatus } from "../../../../lib/chapter-status";

export default function ChaptersScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { project, loading, error, selectedChapterId, setSelectedChapterId } = useProject();
  const { t } = useTranslation();
  const { layout } = useAppTheme();
  const clearance = useTabBarClearance();
  const headerHeight = useAppHeaderHeight();
  const removeChapter = useDeleteChapterMutation();
  const patchProject = usePatchProjectMutation();
  const patchChapter = usePatchChapterMutation();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [tagError, setTagError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

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
              <ManuscriptTag
                genre={project.genre}
                busy={patchProject.isPending}
                error={tagError}
                onSave={saveGenre}
              />
              <Pressable
                style={[layout.card, { marginBottom: 16 }]}
                onPress={() => router.push(bibleIndexHref(projectId) as never)}
                accessibilityRole="button"
                accessibilityLabel={t("bible.title")}
              >
                <Text style={layout.cardTitle}>{t("bible.title")}</Text>
                <Text style={layout.cardMeta}>{t("bible.cardMeta")}</Text>
              </Pressable>
            </View>
          ) : null
        }
        ListEmptyComponent={<Text style={layout.body}>{t("chapters.empty")}</Text>}
        renderItem={({ item, index }) => (
          <ChapterListCard
            chapter={item}
            number={index + 1}
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
          />
        )}
      />
    </View>
  );
}