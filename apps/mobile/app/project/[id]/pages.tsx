import { useMemo } from "react";
import { FlatList, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Redirect, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { AppHeader } from "../../../components/AppHeader";
import { BetaBadge } from "../../../components/BetaBadge";
import { ProjectLoadError } from "../../../components/ProjectLoadError";
import { ScreenErrorBoundary } from "../../../components/ScreenErrorBoundary";
import { ScriptSheet, sheetMetrics } from "../../../components/ScriptSheet";
import { SkeletonList } from "../../../components/Skeleton";
import { manuscriptPagesLabel } from "../../../lib/manuscript-count";
import { useProject } from "../../../lib/project";
import { scriptPages } from "../../../lib/script-pages";
import { useSession } from "../../../lib/session";
import { useAppTheme } from "../../../lib/settings";
import { fonts } from "../../../lib/theme";
import { useStackBack } from "../../../lib/use-stack-back";

/** Air between the screen edge and a sheet, and between two sheets. */
const GUTTER = 20;

/**
 * The script as it prints, page by page: a read-only view for checking that it
 * looks like a script and how long it runs. It is drawn from the same layout and
 * page breaks as the editor's soft rules and the "about N pages" count, so the
 * pages here are the pages there. Writing stays in the manuscript.
 */
function PagesContent({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const { backOr } = useStackBack();
  const { layout, colors } = useAppTheme();
  const { width } = useWindowDimensions();
  const { project, loading, error, errorDetail, reload, selectedChapterId } = useProject();
  const chapters = project?.chapters;
  const script = useMemo(() => scriptPages((chapters ?? []).map((chapter) => chapter.content)), [chapters]);
  const metrics = useMemo(() => sheetMetrics(width - GUTTER * 2), [width]);

  let body;
  if (loading && !project) {
    body = (
      <View style={[layout.padded, { paddingTop: 8 }]}>
        <SkeletonList count={4} accessibilityLabel={t("common.loading")} />
      </View>
    );
  } else if (error && !project) {
    body = <ProjectLoadError message={error} detail={errorDetail} reload={reload} />;
  } else if (script.pages.length === 0) {
    body = (
      <View style={[layout.padded, { paddingTop: 16 }]}>
        <Text style={layout.body}>{t("screenplay.pageView.empty")}</Text>
      </View>
    );
  } else {
    // Open on the first page of the sequence the writer was in.
    const at = Math.max(0, (chapters ?? []).findIndex((chapter) => chapter.id === selectedChapterId));
    const firstPage = script.sequenceStarts[at] ?? 1;
    const initialIndex = Math.max(0, script.pages.findIndex((page) => page.number === firstPage));
    const rowHeight = metrics.height + GUTTER;
    body = (
      <FlatList
        testID="script-pages"
        data={script.pages}
        keyExtractor={(page) => String(page.number)}
        initialScrollIndex={initialIndex}
        getItemLayout={(_, index) => ({ length: rowHeight, offset: rowHeight * index, index })}
        initialNumToRender={2}
        windowSize={5}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: GUTTER, paddingTop: 4, paddingBottom: 48 }}
        ListHeaderComponent={
          <View style={styles.notes}>
            <Text style={[styles.note, { color: colors.inkSoft }]}>{t("screenplay.pageView.readOnly")}</Text>
            <Text style={[styles.note, { color: colors.inkSoft }]}>{t("screenplay.pageView.note")}</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={{ height: rowHeight }}>
            <ScriptSheet
              page={item}
              metrics={metrics}
              colors={colors}
              label={t("screenplay.pageView.page", { number: item.number })}
            />
          </View>
        )}
      />
    );
  }

  return (
    <View style={layout.screen}>
      <AppHeader
        title={t("screenplay.pageView.title")}
        onBack={() => backOr(`/project/${projectId}/chapters`)}
        backAccessibilityLabel={t("bible.backToManuscript")}
        accessory={
          <View style={styles.accessory}>
            <BetaBadge />
            {script.total > 0 ? (
              <Text style={[styles.count, { color: colors.inkSoft }]}>{manuscriptPagesLabel(script.total, t)}</Text>
            ) : null}
          </View>
        }
      />
      {body}
    </View>
  );
}

export default function PagesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, ready } = useSession();
  const projectId = typeof id === "string" ? id : "";

  if (!ready) return null;
  if (!user) return <Redirect href="/login" />;
  if (!projectId) return <Redirect href="/manuscripts" />;

  return (
    <ScreenErrorBoundary>
      <PagesContent projectId={projectId} />
    </ScreenErrorBoundary>
  );
}

const styles = StyleSheet.create({
  notes: { gap: 4, marginBottom: 12 },
  note: { fontFamily: fonts.ui, fontSize: 13, lineHeight: 19 },
  accessory: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 20, paddingBottom: 8 },
  count: { fontFamily: fonts.ui, fontSize: 13 },
});
