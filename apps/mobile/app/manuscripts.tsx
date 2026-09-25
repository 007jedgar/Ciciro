import { useMemo, useState } from "react";
import { FlatList, Platform, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { ApiError, useFoldersQuery, useProjectsQuery } from "../lib/api";
import { AppHeader, useAppHeaderHeight } from "../components/AppHeader";
import { HeaderNewMenu, type NewMenuItem } from "../components/HeaderNewMenu";
import { BellIcon, ChevronRightIcon, FolderIcon, FolderPlusIcon, HistoryIcon, NewChapterIcon } from "../components/icons";
import { SkeletonList } from "../components/Skeleton";
import { useAppTheme } from "../lib/settings";
import { useSession } from "../lib/session";
import { importManuscriptFile, isImportable, pickImportFile } from "../lib/import";
import type { Folder, ProjectListItem } from "../lib/types";

type Row =
  | { key: string; kind: "folder"; folder: Folder }
  | { key: string; kind: "heading"; title: string }
  | { key: string; kind: "project"; project: ProjectListItem };

function queryErrorMessage(error: unknown, fallback: string): string | null {
  if (!error) return null;
  return fallback;
}

export default function ManuscriptsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { user, ready } = useSession();
  const { layout, colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const headerHeight = useAppHeaderHeight();
  const [menuOpen, setMenuOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const enabled = Boolean(user);
  const projectsQuery = useProjectsQuery({ enabled });
  const foldersQuery = useFoldersQuery({ enabled });
  const projects = projectsQuery.data ?? [];
  const folders = foldersQuery.data ?? [];
  const error =
    importError ??
    queryErrorMessage(projectsQuery.error ?? foldersQuery.error, t("errors.requestFailed"));

  async function importManuscript() {
    if (importing) return;
    setImportError(null);
    try {
      const file = await pickImportFile();
      if (!file) return;
      if (!isImportable(file.name)) {
        setImportError(t("importFile.unsupported"));
        return;
      }
      setImporting(true);
      const result = await importManuscriptFile(file, { author: user?.name });
      router.push(`/project/${result.projectId}/chapters`);
    } catch (err) {
      setImportError(err instanceof ApiError ? err.message : t("importFile.error"));
    } finally {
      setImporting(false);
    }
  }

  const rows = useMemo<Row[]>(() => {
    const items: Row[] = folders.map((folder) => ({
      key: `folder-${folder.id}`,
      kind: "folder",
      folder,
    }));
    const unfiled = projects.filter((project) => !project.folderId);
    const listed = folders.length > 0 ? unfiled : projects;
    if (folders.length > 0 && listed.length > 0) {
      items.push({ key: "heading-unfiled", kind: "heading", title: t("manuscripts.unfiled") });
    }
    for (const project of listed) {
      items.push({ key: `project-${project.id}`, kind: "project", project });
    }
    return items;
  }, [folders, projects, t]);

  if (!ready) {
    return (
      <View style={[layout.screen, { paddingHorizontal: 20, paddingTop: 24 }]}>
        <SkeletonList count={6} accessibilityLabel={t("common.loading")} />
      </View>
    );
  }

  if (!user) return <Redirect href="/login" />;

  const loading =
    (projectsQuery.isPending && !projectsQuery.data) ||
    (foldersQuery.isPending && !foldersQuery.data);

  const newItems: NewMenuItem[] = [
    {
      key: "manuscript",
      label: t("manuscripts.newManuscript"),
      Icon: NewChapterIcon,
      onPress: () => router.push("/new-manuscript"),
    },
    {
      key: "import",
      label: importing ? t("importFile.importing") : t("importFile.menu"),
      Icon: NewChapterIcon,
      onPress: () => void importManuscript(),
    },
    {
      key: "folder",
      label: t("manuscripts.newFolder"),
      Icon: FolderPlusIcon,
      onPress: () => router.push("/new-folder"),
    },
    {
      key: "history",
      label: t("history.menu"),
      Icon: HistoryIcon,
      onPress: () => router.push("/writing-history"),
    },
    {
      key: "reminder",
      label: t("reminders.menu"),
      Icon: BellIcon,
      onPress: () => router.push("/writing-reminders"),
    },
  ];

  // An error line already clears the header, so the list starts under it.
  const listTop = error ? 0 : headerHeight;

  return (
    <View style={[layout.screen, { paddingBottom: 0 }]}>
      <View style={{ zIndex: 20 }}>
        <AppHeader
          title={t("manuscripts.title")}
          onSettings={() => router.push("/settings")}
          onNew={() => setMenuOpen((o) => !o)}
          newExpanded={menuOpen}
          floating
        />
      </View>
      {error ? (
        <Text
          style={[layout.error, { marginHorizontal: 20, marginTop: headerHeight + 12 }]}
          role="alert"
        >
          {error}
        </Text>
      ) : null}
      {loading && !error ? (
        <View style={{ paddingHorizontal: 20, paddingTop: (error ? 0 : headerHeight) + 8 }}>
          <SkeletonList count={6} accessibilityLabel={t("common.loading")} />
        </View>
      ) : (
        <FlatList
          scrollEnabled={true}
          data={rows}
          keyExtractor={(item) => item.key}
          // Inset (not padding) on iOS so the pull-to-refresh spinner sits below the header.
          contentInset={{ top: listTop }}
          contentOffset={{ x: 0, y: -listTop }}
          scrollIndicatorInsets={{ top: listTop }}
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingTop: Platform.OS === "ios" ? 0 : listTop,
            paddingBottom: insets.bottom + 20,
          }}
          refreshControl={
            <RefreshControl
              refreshing={
                (projectsQuery.isRefetching || foldersQuery.isRefetching) &&
                !projectsQuery.isPending &&
                !foldersQuery.isPending
              }
              onRefresh={() => {
                void projectsQuery.refetch();
                void foldersQuery.refetch();
              }}
              tintColor={colors.accent}
              progressViewOffset={listTop}
            />
          }
          ListEmptyComponent={
            <Text style={[layout.body, { marginTop: 8 }]}>
              {t("manuscripts.empty")}
            </Text>
          }
          renderItem={({ item }) => {
            if (item.kind === "heading") {
              return (
                <Text style={[layout.cardMeta, { marginBottom: 8, marginTop: 4 }]}>{item.title}</Text>
              );
            }
            if (item.kind === "folder") {
              const count = item.folder._count?.projects ?? item.folder.projects.length;
              return (
                <Pressable
                  style={[layout.card, styles.folderCard]}
                  onPress={() => router.push(`/folder/${item.folder.id}`)}
                  accessibilityRole="button"
                  accessibilityLabel={t("manuscripts.folderA11y", { name: item.folder.name })}
                >
                  <View style={[styles.folderMark, { backgroundColor: colors.accentSoft }]}>
                    <FolderIcon color={colors.accent} size={22} />
                  </View>
                  <View style={styles.folderCopy}>
                    <Text style={layout.cardTitle}>{item.folder.name}</Text>
                    <Text style={layout.cardMeta}>
                      {t("manuscripts.folderKind")}
                      {" · "}
                      {t("manuscripts.count", { count })}
                    </Text>
                    {item.folder.notes ? (
                      <Text style={layout.cardMeta} numberOfLines={2}>
                        {item.folder.notes}
                      </Text>
                    ) : null}
                  </View>
                  <ChevronRightIcon color={colors.inkSoft} />
                </Pressable>
              );
            }
            return (
              <Pressable
                style={layout.card}
                onPress={() => router.push(`/project/${item.project.id}/chapters`)}
              >
                <Text style={layout.cardTitle}>{item.project.title || t("manuscripts.untitled")}</Text>
                <Text style={layout.cardMeta}>
                  {[
                    item.project.genre,
                    item.project._count
                      ? t("manuscripts.chapterCount", { count: item.project._count.chapters })
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || t("manuscripts.fallbackKind")}
                </Text>
                {item.project.logline ? (
                  <Text style={layout.cardMeta}>{item.project.logline}</Text>
                ) : null}
              </Pressable>
            );
          }}
        />
      )}
      <HeaderNewMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        items={newItems}
        closeLabel={t("manuscripts.closeMenu")}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  folderCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  folderMark: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  folderCopy: {
    flex: 1,
  },
});
