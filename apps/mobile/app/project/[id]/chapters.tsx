import { useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { ChapterListCard } from "../../../components/ChapterListCard";
import { ManuscriptTag } from "../../../components/ManuscriptTag";
import { useTabBarClearance } from "../../../components/ManuscriptTabBar";
import { SkeletonList } from "../../../components/Skeleton";
import { useStoryBibleUi } from "../../../components/StoryBibleSheet";
import { ApiError, useDeleteChapterMutation, usePatchProjectMutation } from "../../../lib/api";
import { confirmChapterDelete } from "../../../lib/chapter-delete";
import { useProject } from "../../../lib/project";
import { useAppTheme } from "../../../lib/settings";
import type { Chapter } from "../../../lib/types";

export default function ChaptersScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { project, loading, error, selectedChapterId, setSelectedChapterId } = useProject();
  const { openBible } = useStoryBibleUi();
  const { t } = useTranslation();
  const { layout } = useAppTheme();
  const clearance = useTabBarClearance();
  const removeChapter = useDeleteChapterMutation();
  const patchProject = usePatchProjectMutation();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [tagError, setTagError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  if (loading && !project) {
    return (
      <View style={[layout.padded, { paddingTop: 8 }]}>
        <SkeletonList count={6} accessibilityLabel={t("common.loading")} />
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

  return (
    <View style={layout.padded}>
      {deleteError ? (
        <Text style={[layout.error, { marginTop: 0, marginBottom: 12 }]} role="alert">
          {deleteError}
        </Text>
      ) : null}
      <FlatList
        data={chapters}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: clearance }}
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
                onPress={openBible}
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
        renderItem={({ item }) => (
          <ChapterListCard
            chapter={item}
            selected={item.id === selectedChapterId}
            deleting={pendingId === item.id}
            onOpen={() => {
              setSelectedChapterId(item.id);
              if (projectId) router.navigate(`/project/${projectId}/manuscript`);
            }}
            onRequestDelete={() => requestDelete(item)}
          />
        )}
      />
    </View>
  );
}