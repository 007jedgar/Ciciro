import { useState } from "react";
import { ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import Animated, { FadeInDown, LinearTransition, SlideOutLeft } from "react-native-reanimated";
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
import { switchColors } from "../lib/switch-theme";
import { fonts } from "../lib/theme";
import { fadeUpDelay } from "../lib/skeleton";
import { useUndoableRemoval } from "../lib/undo-removal";
import { useReduceMotion } from "../lib/use-reduce-motion";
import { PressableCard } from "./PressableCard";
import { SkeletonList } from "./Skeleton";
import { UndoSnackbar } from "./UndoSnackbar";
import { TapPressable } from "./TapPressable";
import { AlertText } from "./AlertText";

/** What beta readers said, by chapter, to jump to, resolve, or delete. */
export function ReaderComments({
  projectId,
  chapters,
  chapterId,
  onJump,
  onManageLinks,
}: {
  projectId: string;
  /** The manuscript's chapters in order, for names and numbering. */
  chapters: { id: string; title: string }[];
  /** Start filtered to this chapter (opened from the manuscript). */
  chapterId?: string;
  onJump: (comment: ShareComment) => void;
  onManageLinks: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { colors, layout } = useAppTheme();
  const [status, setStatus] = useState<ShareCommentStatus>("open");
  const [onlyChapter, setOnlyChapter] = useState(Boolean(chapterId));
  const [error, setError] = useState<string | null>(null);
  const list = useShareCommentsQuery(projectId, status);
  const setCommentStatus = useSetShareCommentStatusMutation();
  const remove = useDeleteShareCommentMutation();
  const reduceMotion = useReduceMotion();
  const { hidden, notice, remove: removeWithUndo, undo } = useUndoableRemoval({
    onFailed: (_id, err) => setError(err instanceof ApiError ? err.message : t("beta.actionError")),
  });
  const busy = setCommentStatus.isPending;

  const shown = (list.data ?? []).filter(
    (c) => !hidden.has(c.id) && (!onlyChapter || c.chapterId === chapterId)
  );
  const groups = groupCommentsByChapter(shown, chapters);
  let commentIndex = 0;

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

  // No confirmation: the card slides out and Undo stays up for a few seconds.
  function removeComment(comment: ShareComment) {
    setError(null);
    removeWithUndo(comment.id, t("beta.commentRemoved"), () =>
      remove.mutateAsync({ projectId, commentId: comment.id })
    );
  }

  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language, { month: "short", day: "numeric" });

  return (
    <View style={styles.root}>
    <ScrollView
      testID="reader-comments"
      style={{ flex: 1 }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[layout.body, styles.blurb]}>{t("beta.blurb")}</Text>
      <PressableCard
        style={[layout.card, styles.linksCard]}
        onPress={onManageLinks}
        accessibilityRole="button"
        accessibilityLabel={t("beta.links.title")}
      >
        <Text style={layout.cardTitle}>{t("beta.links.title")}</Text>
        <Text style={layout.cardMeta}>{t("beta.links.cardMeta")}</Text>
      </PressableCard>

      <View style={styles.filters}>
        <View style={[styles.segment, { backgroundColor: colors.panel2 }]}>
          {(["open", "resolved"] as const).map((value) => {
            const active = status === value;
            return (
              <TapPressable
                key={value}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => setStatus(value)}
                style={[styles.segmentBtn, active ? { backgroundColor: colors.panel } : null]}
              >
                <Text style={[styles.segmentText, { color: active ? colors.ink : colors.inkSoft }]}>
                  {t(value === "open" ? "beta.open" : "beta.resolved")}
                </Text>
              </TapPressable>
            );
          })}
        </View>
        {chapterId ? (
          <View style={styles.switchRow}>
            <Text style={layout.cardMeta}>{t("beta.thisChapter")}</Text>
            <Switch
              value={onlyChapter}
              onValueChange={setOnlyChapter}
              {...switchColors(colors)}
              accessibilityLabel={t("beta.thisChapter")}
            />
          </View>
        ) : null}
      </View>

      {error ? (
        <AlertText style={[layout.error, styles.error]} role="alert">
          {error}
        </AlertText>
      ) : null}
      {list.isError ? (
        <AlertText style={[layout.error, styles.error]} role="alert">
          {t("beta.loadError")}
        </AlertText>
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
            <Animated.View
              key={comment.id}
              style={[layout.card, styles.card]}
              testID={`reader-comment-${comment.id}`}
              entering={reduceMotion ? undefined : FadeInDown.duration(240).delay(fadeUpDelay(commentIndex++))}
              exiting={reduceMotion ? undefined : SlideOutLeft.duration(200)}
              layout={reduceMotion ? undefined : LinearTransition.duration(200)}
            >
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
                  <TapPressable
                    accessibilityRole="button"
                    onPress={() => onJump(comment)}
                    hitSlop={8}
                    style={({ pressed }) => [styles.ghostBtn, styles.firstGhostBtn, { opacity: pressed ? 0.6 : 1 }]}
                  >
                    <Text style={[styles.ghostBtnText, { color: colors.accent }]}>
                      {t(comment.anchor.length > 0 ? "beta.showInText" : "beta.showParagraph")}
                    </Text>
                  </TapPressable>
                ) : (
                  <Text style={[layout.cardMeta, styles.gone]}>{t("beta.passageGone")}</Text>
                )}
                <View style={styles.spacer} />
                <TapPressable
                  accessibilityRole="button"
                  onPress={() => removeComment(comment)}
                  disabled={busy}
                  hitSlop={8}
                  style={({ pressed }) => [styles.ghostBtn, { opacity: busy ? 0.4 : pressed ? 0.6 : 1 }]}
                >
                  <Text style={[styles.ghostBtnText, { color: colors.danger }]}>{t("common.delete")}</Text>
                </TapPressable>
                <TapPressable
                  accessibilityRole="button"
                  onPress={() => toggle(comment)}
                  disabled={busy}
                  style={[styles.primaryBtn, { backgroundColor: colors.accent, opacity: busy ? 0.5 : 1 }]}
                >
                  <Text style={[styles.primaryBtnText, { color: colors.panel }]}>
                    {t(comment.status === "open" ? "beta.resolve" : "beta.reopen")}
                  </Text>
                </TapPressable>
              </View>
            </Animated.View>
          ))}
        </View>
      ))}
    </ScrollView>
    <UndoSnackbar message={notice?.message ?? null} onUndo={undo} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
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
  actions: { flexDirection: "row", alignItems: "center", gap: 16, marginTop: 4 },
  spacer: { flex: 1 },
  gone: { fontStyle: "italic" },
  ghostBtn: { paddingHorizontal: 6, paddingVertical: 8 },
  firstGhostBtn: { marginLeft: -6 },
  ghostBtnText: { fontSize: 15, fontWeight: "500" },
  primaryBtn: { borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  primaryBtnText: { fontSize: 15, fontWeight: "600" },
});
