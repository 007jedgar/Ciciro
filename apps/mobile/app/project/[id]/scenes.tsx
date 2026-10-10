import { useCallback, useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { AppHeader } from "../../../components/AppHeader";
import { BetaBadge } from "../../../components/BetaBadge";
import { ArrowDownIcon, ArrowUpIcon } from "../../../components/icons";
import { ProjectLoadError } from "../../../components/ProjectLoadError";
import { ScreenErrorBoundary } from "../../../components/ScreenErrorBoundary";
import { SkeletonList } from "../../../components/Skeleton";
import { TapPressable } from "../../../components/TapPressable";
import { moveSceneOps } from "../../../lib/block-editor";
import * as haptics from "../../../lib/haptics";
import { htmlToDoc } from "../../../lib/manuscript";
import { normalizeKind } from "../../../lib/manuscript-kind";
import { useProject } from "../../../lib/project";
import { sceneOutline, sequenceCursors, elementTagOfHtml, type ScriptBlock } from "../../../lib/screenplay";
import { useSession } from "../../../lib/session";
import { useAppTheme } from "../../../lib/settings";
import { fonts } from "../../../lib/theme";
import { useStackBack } from "../../../lib/use-stack-back";
import type { SyncOp } from "../../../lib/api/types";

/** A sequence's blocks as the engine reads them, each with the id the editor knows it by. */
function sequenceBlocks(content: string): { blocks: ScriptBlock[]; ids: string[] } {
  const found = htmlToDoc(content || "<p></p>", 0).doc.blocks;
  return {
    blocks: found.map((block) => ({ element: elementTagOfHtml(block.html), text: block.text })),
    ids: found.map((block) => block.id),
  };
}

/**
 * The scenes of the script, sequence by sequence, each with its heading and the
 * page it begins on. Tap one to open the manuscript there; move one up or down
 * and its action and dialogue go with it. Everything is derived from the blocks
 * (`sceneOutline`, `moveSceneOps`), so it follows the page as it is written.
 */
function ScenesContent({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { backOr } = useStackBack();
  const { layout, colors } = useAppTheme();
  const { project, loading, error, errorDetail, reload, selectedChapterId, setSelectedChapterId, recordChapterOp, recordReadingPosition } =
    useProject();
  const chapters = project?.chapters;
  const contents = (chapters ?? []).map((chapter) => chapter.content);
  const contentKey = (chapters ?? []).map((chapter) => `${chapter.id}:${chapter.revision}`).join(",");

  const groups = useMemo(() => {
    const { starts } = sequenceCursors(contents);
    return (chapters ?? []).map((chapter, i) => {
      const { blocks, ids } = sequenceBlocks(chapter.content);
      const rows = sceneOutline(blocks, starts[i]).map((row, scene) => ({ ...row, scene }));
      return {
        chapter,
        ids,
        // A lead-in with nothing in it is not a scene to list.
        rows: rows.filter((row) => row.heading !== null || blocks.slice(row.start, row.end).some((b) => b.text.trim() !== "")),
      };
    });
    // The revision stands for the content, so typing elsewhere moves the list without hashing every sequence on each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentKey]);
  const total = groups.reduce((n, g) => n + g.rows.filter((r) => r.heading !== null).length, 0);

  const jump = useCallback(
    (chapterId: string, blockId: string) => {
      setSelectedChapterId(chapterId);
      // The manuscript screen opens where the last reading position says.
      void recordReadingPosition({ chapterId, blockId, offset: 0 });
      router.navigate(`/project/${projectId}/manuscript`);
    },
    [projectId, recordReadingPosition, router, setSelectedChapterId]
  );

  const move = useCallback(
    (chapterId: string, from: number, to: number) => {
      const chapter = chapters?.find((c) => c.id === chapterId);
      if (!chapter) return;
      const ops = moveSceneOps(htmlToDoc(chapter.content, chapter.revision).doc, from, to);
      if (ops.length === 0) return;
      haptics.tap();
      void recordChapterOp(ops.map((op) => ({ ...op, chapterId })) as SyncOp[]);
    },
    [chapters, recordChapterOp]
  );

  let body;
  if (loading && !project) {
    body = (
      <View style={[layout.padded, { paddingTop: 8 }]}>
        <SkeletonList count={5} accessibilityLabel={t("common.loading")} />
      </View>
    );
  } else if (error && !project) {
    body = <ProjectLoadError message={error} detail={errorDetail} reload={reload} />;
  } else if (total === 0) {
    body = (
      <View style={[layout.padded, { paddingTop: 16 }]}>
        <Text style={layout.body}>{t("screenplay.scenes.empty")}</Text>
      </View>
    );
  } else {
    body = (
      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        <Text style={[styles.hint, { color: colors.inkSoft }]}>{t("screenplay.scenes.hint")}</Text>
        {groups.map(({ chapter, ids, rows }) => {
          if (rows.length === 0) return null;
          const headed = rows.filter((row) => row.heading !== null);
          return (
            <View key={chapter.id} style={styles.group}>
              <Text style={[styles.groupTitle, { color: colors.inkSoft }]}>
                {chapter.title || t("screenplay.scenes.untitledSequence")}
              </Text>
              {rows.map((row) => {
                const position = headed.indexOf(row);
                const before = headed[position - 1];
                const after = headed[position + 1];
                const title = row.heading === null ? t("screenplay.scenes.lead") : row.title || t("screenplay.scenes.untitled");
                return (
                  <View key={row.scene} style={[styles.row, { borderBottomColor: colors.line }]}>
                    <TapPressable
                      testID={`scene-row-${chapter.id}-${row.scene}`}
                      feedback="none"
                      highlight
                      accessibilityLabel={`${title}, ${t("screenplay.scenes.page", { number: row.page })}`}
                      onPress={() => jump(chapter.id, ids[row.start] ?? "")}
                      style={styles.main}
                    >
                      <Text style={[styles.number, { color: colors.inkSoft }]}>{row.heading === null ? "" : position + 1}</Text>
                      <Text
                        numberOfLines={1}
                        style={[
                          row.heading === null ? styles.lead : styles.title,
                          { color: row.heading === null || row.title === "" ? colors.inkSoft : colors.ink },
                        ]}
                      >
                        {title}
                      </Text>
                      <Text style={[styles.page, { color: colors.inkSoft }]}>{t("screenplay.scenes.page", { number: row.page })}</Text>
                    </TapPressable>
                    {row.heading !== null ? (
                      <View style={styles.moves}>
                        <TapPressable
                          feedback="dim"
                          haptic="none"
                          disabled={!before}
                          accessibilityLabel={t("screenplay.scenes.moveUp", { title })}
                          onPress={() => before && move(chapter.id, row.scene, before.scene)}
                          style={[styles.move, { opacity: before ? 1 : 0.3 }]}
                        >
                          <ArrowUpIcon color={colors.accent} />
                        </TapPressable>
                        <TapPressable
                          feedback="dim"
                          haptic="none"
                          disabled={!after}
                          accessibilityLabel={t("screenplay.scenes.moveDown", { title })}
                          onPress={() => after && move(chapter.id, row.scene, after.scene)}
                          style={[styles.move, { opacity: after ? 1 : 0.3 }]}
                        >
                          <ArrowDownIcon color={colors.accent} />
                        </TapPressable>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          );
        })}
      </ScrollView>
    );
  }

  return (
    <View style={layout.screen}>
      <AppHeader
        title={t("screenplay.scenes.title")}
        onBack={() => backOr(`/project/${projectId}/chapters`)}
        backAccessibilityLabel={t("screenplay.scenes.back")}
        accessory={
          <View style={styles.accessory}>
            <BetaBadge />
            {total > 0 ? <Text style={[styles.count, { color: colors.inkSoft }]}>{t("screenplay.scenes.count", { count: total })}</Text> : null}
          </View>
        }
      />
      {body}
    </View>
  );
}

export default function ScenesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, ready } = useSession();
  const projectId = typeof id === "string" ? id : "";
  const { project } = useProject();

  if (!ready) return null;
  if (!user) return <Redirect href="/login" />;
  if (!projectId) return <Redirect href="/manuscripts" />;
  // Only a screenplay has scenes to list.
  if (project && normalizeKind(project.kind) !== "screenplay") return <Redirect href={`/project/${projectId}/chapters`} />;

  return (
    <ScreenErrorBoundary>
      <ScenesContent projectId={projectId} />
    </ScreenErrorBoundary>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 20, paddingBottom: 48 },
  hint: { fontFamily: fonts.ui, fontSize: 13, lineHeight: 19, paddingTop: 4, paddingBottom: 12 },
  group: { marginBottom: 16 },
  groupTitle: { fontFamily: fonts.ui, fontSize: 12, letterSpacing: 0.6, textTransform: "uppercase", paddingBottom: 4 },
  row: { flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth },
  main: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48, paddingVertical: 8 },
  number: { width: 22, textAlign: "right", fontFamily: fonts.mono, fontSize: 12 },
  title: { flex: 1, fontFamily: fonts.mono, fontSize: 13 },
  lead: { flex: 1, fontFamily: fonts.ui, fontSize: 13, fontStyle: "italic" },
  page: { fontFamily: fonts.ui, fontSize: 12 },
  moves: { flexDirection: "row" },
  move: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  accessory: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 20, paddingBottom: 8 },
  count: { fontFamily: fonts.ui, fontSize: 13 },
});
