import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import {
  ApiError,
  useDeleteShareCommentMutation,
  useSetShareCommentStatusMutation,
  useShareCommentsQuery,
} from "../lib/api";
import type { ShareComment, ShareCommentStatus } from "../lib/api/types";
import { chapterNumberLabel, customChapterTitle } from "../lib/chapter-label";
import { groupCommentsByChapter } from "../lib/shares";
import { useAppTheme } from "../lib/settings";
import { fonts } from "../lib/theme";
import { SkeletonList } from "./Skeleton";

export type ReaderCommentsHost = { alert: typeof Alert.alert };

/** What beta readers said, by chapter, to jump to, resolve, or delete. */
export function ReaderComments({
  projectId,
  chapters,
  chapterId,
  onJump,
  onManageLinks,
  host = Alert,
}: {
  projectId: string;
  /** The manuscript's chapters in order, for names and numbering. */
  chapters: { id: string; title: string }[];
  /** Start filtered to this chapter (opened from the manuscript). */
  chapterId?: string;
  onJump: (comment: ShareComment) => void;
  onManageLinks: () => void;
  host?: ReaderCommentsHost;
}) {
  const { t, i18n } = useTranslation();
  const { colors, layout } = useAppTheme();
  const [status, setStatus] = useState<ShareCommentStatus>("open");
  const [onlyChapter, setOnlyChapter] = useState(Boolean(chapterId));
  const [error, setError] = useState<string | null>(null);
  const list = useShareCommentsQuery(projectId, status);
  const setCommentStatus = useSetShareCommentStatusMutation();
  const remove = useDeleteShareCommentMutation();
  const busy = setCommentStatus.isPending || remove.isPending;

  const shown = (list.data ?? []).filter((c) => !onlyChapter || c.chapterId === chapterId);
  const groups = groupCommentsByChapter(shown, chapters);

  function chapterHeading(number: number, title: string): string {
    if (!number) return title || t("beta.archivedChapter");
    const numbered = chapterNumberLabel(number, (key, opts) => t(key, opts));
    const custom = customChapterTitle(title, numbered, t("chapters.newTitle"));
    return custom ? `${numbered} · ${custom}` : numbered;
  }

  function run(action: Promise<unknown>) {
    setError(null);
    action.catch((err: unknown) => {
      setError(err instanceof ApiError ? err.message : t("beta.actionError"));
    });
  }

  function toggle(comment: ShareComment) {
    run(
      setCommentStatus.mutateAsync({
        projectId,
        commentId: comment.id,
        status: comment.status === "open" ? "resolved" : "open",
      })
    );
  }

  function confirmDelete(comment: ShareComment) {
    host.alert(t("beta.deleteTitle"), t("beta.deleteMessage"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: () => run(remove.mutateAsync({ projectId, commentId: comment.id })),
      },
    ]);
  }

  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language, { month: "short", day: "numeric" });

  return (
    <ScrollView
      testID="reader-comments"
      style={{ flex: 1 }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[layout.body, styles.blurb]}>{t("beta.blurb")}</Text>
      <Pressable
        style={[layout.card, styles.linksCard]}
        onPress={onManageLinks}
        accessibilityRole="button"
        accessibilityLabel={t("beta.links.title")}
      >
        <Text style={layout.cardTitle}>{t("beta.links.title")}</Text>
        <Text style={layout.cardMeta}>{t("beta.links.cardMeta")}</Text>
      </Pressable>

      <View style={styles.filters}>
        <View style={[styles.segment, { backgroundColor: colors.panel2 }]}>
          {(["open", "resolved"] as const).map((value) => {
            const active = status === value;
            return (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => setStatus(value)}
                style={[styles.segmentBtn, active ? { backgroundColor: colors.panel } : null]}
              >
                <Text style={[styles.segmentText, { color: active ? colors.ink : colors.inkSoft }]}>
                  {t(value === "open" ? "beta.open" : "beta.resolved")}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {chapterId ? (
          <View style={styles.switchRow}>
            <Text style={layout.cardMeta}>{t("beta.thisChapter")}</Text>
            <Switch
              value={onlyChapter}
              onValueChange={setOnlyChapter}
              accessibilityLabel={t("beta.thisChapter")}
            />
          </View>
        ) : null}
      </View>

      {error ? (
        <Text style={[layout.error, styles.error]} role="alert">
          {error}
        </Text>
      ) : null}
      {list.isError ? (
        <Text style={[layout.error, styles.error]} role="alert">
          {t("beta.loadError")}
        </Text>
      ) : null}
      {list.isPending && !list.data ? (
        <SkeletonList count={3} accessibilityLabel={t("common.loading")} />
      ) : null}
      {list.data && shown.length === 0 ? (
        <Text style={layout.body}>{t(status === "open" ? "beta.emptyOpen" : "beta.emptyResolved")}</Text>
      ) : null}

      {groups.map((group) => (
        <View key={group.chapterId} style={styles.group}>
          {!onlyChapter ? (
            <Text style={[layout.cardMeta, styles.groupTitle]}>{chapterHeading(group.number, group.title)}</Text>
          ) : null}
          {group.comments.map((comment) => (
            <View key={comment.id} style={[layout.card, styles.card]} testID={`reader-comment-${comment.id}`}>
              <View style={[styles.quote, { borderLeftColor: colors.accent }]}>
                <Text style={[styles.quoteText, { color: colors.inkSoft }]} numberOfLines={4}>
                  {comment.quote}
                </Text>
              </View>
              <Text style={[layout.body, styles.body]}>{comment.body}</Text>
              <Text style={layout.cardMeta}>
                {comment.linkLabel
                  ? t("beta.bylineLink", { name: comment.readerName, link: comment.linkLabel, date: date(comment.createdAt) })
                  : t("beta.byline", { name: comment.readerName, date: date(comment.createdAt) })}
              </Text>
              <View style={styles.actions}>
                {comment.anchor ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => onJump(comment)}
                    hitSlop={8}
                    style={({ pressed }) => [styles.ghostBtn, { opacity: pressed ? 0.6 : 1 }]}
                  >
                    <Text style={[styles.ghostBtnText, { color: colors.accent }]}>
                      {t(comment.anchor.length > 0 ? "beta.showInText" : "beta.showParagraph")}
                    </Text>
                  </Pressable>
                ) : (
                  <Text style={[layout.cardMeta, styles.gone]}>{t("beta.passageGone")}</Text>
                )}
                <View style={styles.spacer} />
                <Pressable
                  accessibilityRole="button"
                  onPress={() => confirmDelete(comment)}
                  disabled={busy}
                  hitSlop={8}
                  style={({ pressed }) => [styles.ghostBtn, { opacity: busy ? 0.4 : pressed ? 0.6 : 1 }]}
                >
                  <Text style={[styles.ghostBtnText, { color: colors.danger }]}>{t("common.delete")}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => toggle(comment)}
                  disabled={busy}
                  style={[styles.primaryBtn, { backgroundColor: colors.accent, opacity: busy ? 0.5 : 1 }]}
                >
                  <Text style={[styles.primaryBtnText, { color: colors.panel }]}>
                    {t(comment.status === "open" ? "beta.resolve" : "beta.reopen")}
                  </Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 48 },
  blurb: { marginBottom: 16 },
  linksCard: { marginBottom: 20 },
  filters: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
    gap: 12,
  },
  segment: { flexDirection: "row", alignSelf: "flex-start", borderRadius: 8, padding: 3 },
  segmentBtn: { borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6 },
  segmentText: { fontSize: 13, fontWeight: "600" },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  error: { marginTop: 0, marginBottom: 12 },
  group: { marginBottom: 8 },
  groupTitle: { fontWeight: "600", marginBottom: 8, marginTop: 4 },
  card: { marginBottom: 12, gap: 8 },
  quote: { borderLeftWidth: 3, paddingLeft: 10 },
  quoteText: { fontFamily: fonts.serif, fontSize: 15, lineHeight: 22 },
  body: { marginBottom: 0 },
  actions: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  spacer: { flex: 1 },
  gone: { fontStyle: "italic" },
  ghostBtn: { paddingHorizontal: 6, paddingVertical: 8 },
  ghostBtnText: { fontSize: 15, fontWeight: "500" },
  primaryBtn: { borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  primaryBtnText: { fontSize: 15, fontWeight: "600" },
});
