import { ManuscriptMeta } from "../components/ManuscriptMeta";
import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, RefreshControl, StyleSheet, Text, View } from "react-native";
import Animated, { FadeInDown, LinearTransition, SlideInRight } from "react-native-reanimated";
import { Redirect, useIsFocused, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { ApiError, useFoldersQuery, useProjectsQuery } from "../lib/api";
import { AppHeader, useMeasuredAppHeaderHeight } from "../components/AppHeader";
import { HeaderNewMenu, type NewMenuItem } from "../components/HeaderNewMenu";
import { ChevronRightIcon, FolderIcon, FolderPlusIcon, ImportIcon, NewChapterIcon } from "../components/icons";
import { MorphRowText, beginRowMorph } from "../components/MorphRowText";
import { ScreenErrorBoundary } from "../components/ScreenErrorBoundary";
import { ScreenErrorState } from "../components/ScreenErrorState";
import { SkeletonList } from "../components/Skeleton";
import { fadeUpDelay } from "../lib/skeleton";
import { folderMorphKey, manuscriptMorphKey, useSharedTitleMorph } from "../lib/shared-title-morph";
import { useAppTheme } from "../lib/settings";
import { useReduceMotion } from "../lib/use-reduce-motion";
import { useSession } from "../lib/session";
import { importManuscriptFile, isImportable, pickImportFile } from "../lib/import";
import { getAnalytics } from "../lib/analytics-client";
import type { Folder, ProjectListItem } from "../lib/types";
import { PressableCard } from "../components/PressableCard";
import { AlertText } from "../components/AlertText";
import { TapPressable } from "../components/TapPressable";

type Row =
  | { key: string; kind: "folder"; folder: Folder }
  | { key: string; kind: "heading"; title: string }
  | { key: string; kind: "project"; project: ProjectListItem };

export default function ManuscriptsScreen() {
  return (
    <ScreenErrorBoundary>
      <ManuscriptsScreenContent />
    </ScreenErrorBoundary>
  );
}

function ManuscriptsScreenContent() {
  const router = useRouter();
  const { t } = useTranslation();
  const { user, ready } = useSession();
  const { layout, colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [headerHeight, onHeaderHeight] = useMeasuredAppHeaderHeight();
  const [menuOpen, setMenuOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryAttempted, setRetryAttempted] = useState(false);
  const enabled = Boolean(user);
  const projectsQuery = useProjectsQuery({ enabled });
  const foldersQuery = useFoldersQuery({ enabled });
  const morph = useSharedTitleMorph();
  const cardTitleMorphStyle = useMemo(() => {
    const cardTitleStyle = StyleSheet.flatten(layout.cardTitle);
    return {
      color: String(cardTitleStyle.color ?? colors.ink),
      fontFamily: cardTitleStyle.fontFamily,
      fontSize: typeof cardTitleStyle.fontSize === "number" ? cardTitleStyle.fontSize : 18,
    };
  }, [layout.cardTitle, colors.ink]);
  const projects = projectsQuery.data ?? [];
  const folders = foldersQuery.data ?? [];
  const queryError = projectsQuery.error ?? foldersQuery.error;
  const queryErrorDetail = queryError instanceof ApiError ? queryError.message : null;
  const friendlyQueryError = queryError ? t("manuscripts.loadError") : null;
  const error = importError ?? friendlyQueryError;
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    if (!queryError) setRetryAttempted(false);
  }, [queryError]);

  async function refetchAll() {
    const results = await Promise.allSettled([projectsQuery.refetch(), foldersQuery.refetch()]);
    return results.every((r) => r.status === "fulfilled" && !r.value.isError);
  }

  async function retry() {
    setRetrying(true);
    const loaded = await refetchAll();
    setRetrying(false);
    setRetryAttempted(!loaded);
  }

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

  const loading =
    (projectsQuery.isPending && !projectsQuery.data) ||
    (foldersQuery.isPending && !foldersQuery.data);
  const listShown = ready && Boolean(user) && !loading;

  // Rows the list has already shown, so only a folder/manuscript created later slides in.
  const seenKeys = useRef<Set<string> | null>(null);
  if (seenKeys.current === null && listShown) {
    seenKeys.current = new Set(rows.filter((r) => r.kind !== "heading").map((r) => r.key));
  }
  const freshKeys = new Set(
    rows
      .filter((r) => r.kind !== "heading" && seenKeys.current !== null && !seenKeys.current.has(r.key))
      .map((r) => r.key)
  );
  const freshKey = [...freshKeys].join(",");

  useEffect(() => {
    if (!freshKey || !seenKeys.current) return;
    for (const key of freshKey.split(",")) seenKeys.current.add(key);
  }, [freshKey]);

  // Only the first screenful staggers in; rows FlatList mounts later (further batches, scrolling back) just appear.
  const revealed = useRef(false);
  useEffect(() => {
    if (listShown) revealed.current = true;
  }, [listShown]);

  // Blurred, this screen sits detached under another one (react-native-screens), so a refetch
  // that lands meanwhile (creating or importing a manuscript opens its chapters straight away)
  // must not start motion there: rows that arrive while blurred are simply seen.
  const focused = useIsFocused();

  // The list-level reflow runs for the first reveal and on any render that changes the rows
  // (a new, removed or reordered item) while the screen is focused - never on a render where
  // the rows are unchanged, like the one reattaching this screen after a chapters visit, which
  // would otherwise animate cells from a stale pre-detach layout and can land them collapsed.
  const rowsKey = rows.map((r) => r.key).join(",");
  const committedRowsKey = useRef<string | null>(null);
  useEffect(() => {
    if (listShown) committedRowsKey.current = rowsKey;
  }, [listShown, rowsKey]);
  const rowsChanged = committedRowsKey.current !== null && committedRowsKey.current !== rowsKey;
  const layoutAnimating = !reduceMotion && focused && (!revealed.current || rowsChanged);

  if (!ready) {
    return (
      <View style={[layout.screen, { paddingHorizontal: 20, paddingTop: 24 }]}>
        <SkeletonList count={6} accessibilityLabel={t("common.loading")} />
      </View>
    );
  }

  if (!user) return <Redirect href="/login" />;

  const newItems: NewMenuItem[] = [
    {
      key: "manuscript",
      label: t("manuscripts.newManuscript"),
      Icon: NewChapterIcon,
      onPress: () => {
        getAnalytics().track("cta_clicked", { cta: "new_manuscript", surface: "library" });
        router.push("/new-manuscript");
      },
    },
    {
      key: "import",
      label: importing ? t("importFile.importing") : t("importFile.menu"),
      Icon: ImportIcon,
      onPress: () => void importManuscript(),
    },
    {
      key: "folder",
      label: t("manuscripts.newFolder"),
      Icon: FolderPlusIcon,
      onPress: () => router.push("/new-folder"),
    },
  ];

  // A banner (import error or a query error with rows still to show) already
  // clears the header, so the list starts under it; a query error with
  // nothing to show instead renders inside the list as its empty state,
  // which still needs the inset since nothing pushed the flow down for it.
  const showInlineBanner = Boolean(importError) || Boolean(queryError && rows.length > 0);
  const listTop = showInlineBanner ? 0 : headerHeight;

  return (
    <View style={[layout.screen, { paddingBottom: 0 }]}>
      <View style={{ zIndex: 20 }}>
        <AppHeader
          title={t("manuscripts.title")}
          onSettings={() => router.push("/settings")}
          onNew={() => setMenuOpen((o) => !o)}
          newExpanded={menuOpen}
          floating
          onHeightChange={onHeaderHeight}
        />
      </View>
      {importError ? (
        <AlertText
          style={[layout.error, { marginHorizontal: 20, marginTop: headerHeight + 12 }]}
          role="alert"
        >
          {importError}
        </AlertText>
      ) : null}
      {queryError && rows.length > 0 ? (
        <ScreenErrorState
          variant="inline"
          message={t("manuscripts.loadError")}
          detail={queryErrorDetail}
          onRetry={() => void retry()}
          retrying={retrying}
          showRestart={retryAttempted}
          style={{
            marginHorizontal: 20,
            marginTop: importError ? 8 : headerHeight + 12,
            marginBottom: 12,
          }}
        />
      ) : null}
      {loading && !error ? (
        <View style={{ paddingHorizontal: 20, paddingTop: (showInlineBanner ? 0 : headerHeight) + 8 }}>
          <SkeletonList count={6} accessibilityLabel={t("common.loading")} />
        </View>
      ) : (
        <Animated.FlatList
          scrollEnabled={true}
          data={rows}
          itemLayoutAnimation={layoutAnimating ? LinearTransition.duration(200) : undefined}
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
              // Only a pull shows the spinner: a background refetch (one fires
              // as a row's push starts) would shift the list mid-transition.
              refreshing={pulling}
              onRefresh={() => {
                setPulling(true);
                void refetchAll().finally(() => setPulling(false));
              }}
              tintColor={colors.accent}
              progressViewOffset={listTop}
            />
          }
          ListEmptyComponent={
            queryError ? (
              <ScreenErrorState
                variant="full"
                message={t("manuscripts.loadError")}
                detail={queryErrorDetail}
                onRetry={() => void retry()}
                retrying={retrying}
                showRestart={retryAttempted}
                style={{ marginTop: 16 }}
              />
            ) : (
              <View style={{ marginTop: 8 }}>
                <Text style={layout.body}>{t("manuscripts.empty")}</Text>
                <TapPressable
                  style={layout.primaryBtn}
                  onPress={() => router.push("/new-manuscript")}
                  accessibilityRole="button"
                  accessibilityLabel={t("manuscripts.newManuscript")}
                >
                  <Text style={layout.primaryBtnText}>{t("manuscripts.newManuscript")}</Text>
                </TapPressable>
              </View>
            )
          }
          renderItem={({ item, index }) => {
            if (item.kind === "heading") {
              return (
                <Text style={[layout.cardMeta, { marginBottom: 8, marginTop: 4 }]}>{item.title}</Text>
              );
            }
            const entering =
              reduceMotion || !focused
                ? undefined
                : freshKeys.has(item.key)
                  ? SlideInRight.duration(260)
                  : revealed.current
                    ? undefined
                    : FadeInDown.duration(240).delay(fadeUpDelay(index));
            if (item.kind === "folder") {
              const count = item.folder._count?.projects ?? item.folder.projects.length;
              const folderKey = folderMorphKey(item.folder.id);
              return (
                <Animated.View entering={entering}>
                  <PressableCard
                    style={[layout.card, styles.folderCard]}
                    onPress={async () => {
                      await beginRowMorph(morph, folderKey);
                      router.push(`/folder/${item.folder.id}`);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={t("manuscripts.folderA11y", { name: item.folder.name })}
                  >
                    <View style={[styles.folderMark, { backgroundColor: colors.accentSoft }]}>
                      <FolderIcon color={colors.accent} size={22} />
                    </View>
                    <View style={styles.folderCopy}>
                      <MorphRowText morphKey={folderKey} morphStyle={cardTitleMorphStyle} style={layout.cardTitle}>
                        {item.folder.name}
                      </MorphRowText>
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
                  </PressableCard>
                </Animated.View>
              );
            }
            const manuscriptKey = manuscriptMorphKey(item.project.id);
            return (
              <Animated.View entering={entering}>
                <PressableCard
                  style={layout.card}
                  onPress={async () => {
                    await beginRowMorph(morph, manuscriptKey);
                    router.push(`/project/${item.project.id}/chapters`);
                  }}
                >
                  <MorphRowText morphKey={manuscriptKey} morphStyle={cardTitleMorphStyle} style={layout.cardTitle}>
                    {item.project.title || t("manuscripts.untitled")}
                  </MorphRowText>
                  <ManuscriptMeta project={item.project} />
                  {item.project.logline ? (
                    <Text style={layout.cardMeta}>{item.project.logline}</Text>
                  ) : null}
                </PressableCard>
              </Animated.View>
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
