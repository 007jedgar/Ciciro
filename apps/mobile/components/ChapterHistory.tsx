import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useTranslation } from "react-i18next";
import {
  ApiError,
  useChapterSnapshotQuery,
  useChapterSnapshotsQuery,
  useDeleteSnapshotMutation,
  useRestoreSnapshotMutation,
  useSaveSnapshotMutation,
} from "../lib/api";
import type { ChapterSnapshotSummary } from "../lib/api/types";
import { htmlToPlainText } from "../lib/html";
import { useAppTheme } from "../lib/settings";
import {
  diffStats,
  formatSnapshotTime,
  restoreSummary,
  SNAPSHOT_LABEL_MAX,
  snapshotDiff,
  snapshotTitle,
} from "../lib/snapshots";
import { fonts } from "../lib/theme";
import { useReduceMotion } from "../lib/use-reduce-motion";
import { alpha } from "./Glass";
import { SkeletonList } from "./Skeleton";
import { Snackbar } from "./Snackbar";

/** How long "Version restored - Undo" stays up. */
const NOTICE_MS = 8000;

type Notice = { kind: "restored"; backup: ChapterSnapshotSummary | null } | { kind: "undone" };

export type ChapterHistoryHost = { alert: typeof Alert.alert };

export function ChapterHistory({
  chapterId,
  currentContent,
  settle,
  host = Alert,
}: {
  chapterId: string;
  /** The chapter as this device shows it now, for the comparison. */
  currentContent: string;
  /**
   * Push this device's queued edits and pull the server's. Runs before a
   * snapshot or restore so it sees the latest typing, and after a restore so
   * the restored text arrives here as ops, the same way any other edit does.
   */
  settle: () => Promise<unknown>;
  host?: ChapterHistoryHost;
}) {
  const { t, i18n } = useTranslation();
  const { colors, dark, layout, settings } = useAppTheme();
  const reduceMotion = useReduceMotion();
  const list = useChapterSnapshotsQuery(chapterId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const detail = useChapterSnapshotQuery(chapterId, selectedId ?? "", { enabled: Boolean(selectedId) });
  const save = useSaveSnapshotMutation();
  const restoreMutation = useRestoreSnapshotMutation();
  const remove = useDeleteSnapshotMutation();
  const [mode, setMode] = useState<"changes" | "text">("changes");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [restoring, setRestoring] = useState(false);
  const busy = save.isPending || restoring || remove.isPending;

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const selected = detail.data?.id === selectedId ? detail.data : null;
  const parts = useMemo(
    () => (selected ? snapshotDiff(currentContent, selected.content) : []),
    [selected, currentContent]
  );
  const summary = useMemo(() => restoreSummary(diffStats(parts), t), [parts, t]);

  function failure(err: unknown, fallback: string) {
    setError(err instanceof ApiError ? err.message : fallback);
  }

  async function saveSnapshot() {
    if (busy) return;
    setError(null);
    try {
      await settle();
      await save.mutateAsync({ chapterId, label: label.trim() || undefined });
      setLabel("");
    } catch (err) {
      failure(err, t("history.saveError"));
    }
  }

  async function restore(snapshot: ChapterSnapshotSummary, undo = false) {
    setError(null);
    setRestoring(true);
    try {
      await settle();
      const result = await restoreMutation.mutateAsync({ chapterId, snapshotId: snapshot.id });
      setSelectedId(null);
      setNotice(undo ? { kind: "undone" } : { kind: "restored", backup: result.backup });
      await settle();
    } catch (err) {
      failure(err, t("history.restoreError"));
    } finally {
      setRestoring(false);
    }
  }

  function confirmRestore(snapshot: ChapterSnapshotSummary) {
    host.alert(t("history.restoreTitle"), t("history.restoreMessage"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("history.restore"), onPress: () => void restore(snapshot) },
    ]);
  }

  function undoRestore() {
    if (notice?.kind !== "restored" || !notice.backup) return;
    const backup = notice.backup;
    setNotice(null);
    void restore(backup, true);
  }

  function confirmDelete(snapshot: ChapterSnapshotSummary) {
    host.alert(t("history.deleteTitle"), t("history.deleteMessage"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: () => {
          setError(null);
          remove
            .mutateAsync({ chapterId, snapshotId: snapshot.id })
            .then(() => {
              setSelectedId(null);
              if (notice?.kind === "restored" && notice.backup?.id === snapshot.id) setNotice(null);
            })
            .catch((err: unknown) => failure(err, t("history.deleteError")));
        },
      },
    ]);
  }

  const prose = {
    fontFamily: settings.editorFont === "sans" ? fonts.sans : fonts.serif,
    fontSize: 16,
    lineHeight: 26,
    color: colors.ink,
  };
  const added = { color: colors.draft, backgroundColor: alpha(colors.draft, 0.16) };
  const removed = {
    color: colors.danger,
    backgroundColor: alpha(colors.danger, 0.12),
    textDecorationLine: "line-through" as const,
  };

  return (
    <View style={{ flex: 1 }}>
      <KeyboardAwareScrollView
        testID="chapter-history"
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        bottomOffset={24}
      >
        <Text style={[layout.body, styles.blurb]}>{t("history.blurb")}</Text>
        <View style={styles.saveRow}>
          <TextInput
            style={[styles.input, { backgroundColor: colors.panel, borderColor: colors.line, color: colors.ink }]}
            accessibilityLabel={t("history.namePlaceholder")}
            placeholder={t("history.namePlaceholder")}
            placeholderTextColor={colors.inkSoft}
            value={label}
            onChangeText={setLabel}
            maxLength={SNAPSHOT_LABEL_MAX}
            onSubmitEditing={() => void saveSnapshot()}
            returnKeyType="done"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("history.save")}
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={() => void saveSnapshot()}
            style={[styles.primaryBtn, { backgroundColor: colors.accent, opacity: busy ? 0.5 : 1 }]}
          >
            <Text style={[styles.primaryBtnText, { color: colors.panel }]}>
              {save.isPending ? t("history.saving") : t("history.save")}
            </Text>
          </Pressable>
        </View>
        {error ? (
          <Text style={[layout.error, styles.error]} role="alert">
            {error}
          </Text>
        ) : null}
        {list.isError ? (
          <Text style={[layout.error, styles.error]} role="alert">
            {t("history.loadError")}
          </Text>
        ) : null}

        {list.isPending ? (
          <SkeletonList count={4} accessibilityLabel={t("common.loading")} />
        ) : list.data && list.data.length === 0 ? (
          <Text style={layout.body}>{t("history.empty")}</Text>
        ) : (
          list.data?.map((snapshot) => {
            const open = snapshot.id === selectedId;
            const title = snapshotTitle(snapshot, t);
            const time = formatSnapshotTime(snapshot.createdAt, i18n.language, t);
            const words = t("chapters.wordCount", { count: snapshot.wordCount });
            return (
              <View
                key={snapshot.id}
                style={[layout.card, styles.card, open ? { borderColor: colors.inkSoft } : null]}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("history.versionA11y", { title, time, words })}
                  accessibilityState={{ expanded: open }}
                  onPress={() => {
                    setSelectedId(open ? null : snapshot.id);
                    setMode("changes");
                  }}
                  style={({ pressed }) => [styles.row, pressed ? { backgroundColor: colors.panel2 } : null]}
                >
                  <Text style={layout.cardTitle} numberOfLines={1}>
                    {title}
                  </Text>
                  <Text style={layout.cardMeta}>{`${time} · ${words}`}</Text>
                </Pressable>
                {open ? (
                  <View style={[styles.preview, { borderTopColor: colors.line }]}>
                    <View style={[styles.segment, { backgroundColor: colors.panel2 }]}>
                      {(["changes", "text"] as const).map((value) => {
                        const active = mode === value;
                        return (
                          <Pressable
                            key={value}
                            accessibilityRole="button"
                            accessibilityState={{ selected: active }}
                            onPress={() => setMode(value)}
                            style={[styles.segmentBtn, active ? { backgroundColor: colors.panel } : null]}
                          >
                            <Text
                              style={[
                                styles.segmentText,
                                { color: active ? colors.ink : colors.inkSoft },
                              ]}
                            >
                              {value === "changes" ? t("history.changes") : t("history.fullText")}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    {detail.isError ? (
                      <Text style={[layout.error, styles.error]}>{t("history.versionError")}</Text>
                    ) : !selected ? (
                      <Text style={layout.cardMeta}>{t("history.loadingVersion")}</Text>
                    ) : mode === "changes" ? (
                      <>
                        <Text style={[layout.cardMeta, styles.summary]}>{summary}</Text>
                        <Text testID="snapshot-diff" style={prose}>
                          {parts.map((part, index) => (
                            <Text
                              key={index}
                              style={part.kind === "added" ? added : part.kind === "removed" ? removed : undefined}
                            >
                              {part.text}
                            </Text>
                          ))}
                        </Text>
                      </>
                    ) : (
                      <Text testID="snapshot-text" style={prose}>
                        {htmlToPlainText(selected.content) || t("history.emptyVersion")}
                      </Text>
                    )}
                    <View style={styles.actions}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("common.delete")}
                        disabled={busy}
                        onPress={() => confirmDelete(snapshot)}
                        hitSlop={8}
                        style={({ pressed }) => [styles.ghostBtn, { opacity: busy ? 0.4 : pressed ? 0.6 : 1 }]}
                      >
                        <Text style={[styles.ghostBtnText, { color: colors.danger }]}>
                          {t("common.delete")}
                        </Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("history.restore")}
                        accessibilityState={{ disabled: busy || !selected }}
                        disabled={busy || !selected}
                        onPress={() => confirmRestore(snapshot)}
                        style={[
                          styles.primaryBtn,
                          { backgroundColor: colors.accent, opacity: busy || !selected ? 0.5 : 1 },
                        ]}
                      >
                        <Text style={[styles.primaryBtnText, { color: colors.panel }]}>
                          {restoring ? t("history.restoring") : t("history.restore")}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}
              </View>
            );
          })
        )}
      </KeyboardAwareScrollView>
      {notice ? (
        <View pointerEvents="box-none" style={styles.noticeDock}>
          <Snackbar
            message={notice.kind === "undone" ? t("history.undone") : t("history.restored")}
            actionLabel={notice.kind === "restored" && notice.backup ? t("history.undo") : undefined}
            onAction={notice.kind === "restored" && notice.backup ? undoRestore : undefined}
            colors={colors}
            dark={dark}
            reduceMotion={reduceMotion}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 120 },
  blurb: { fontSize: 14, lineHeight: 21, marginBottom: 14 },
  saveRow: { flexDirection: "row", gap: 8, alignItems: "center", marginBottom: 16 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  primaryBtn: { borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
  primaryBtnText: { fontSize: 15, fontWeight: "600" },
  ghostBtn: { paddingHorizontal: 6, paddingVertical: 10 },
  ghostBtnText: { fontSize: 15, fontWeight: "500" },
  error: { marginTop: 0, marginBottom: 12 },
  card: { padding: 0, overflow: "hidden" },
  row: { paddingHorizontal: 16, paddingVertical: 14 },
  preview: { borderTopWidth: StyleSheet.hairlineWidth, padding: 16, gap: 12 },
  segment: { flexDirection: "row", alignSelf: "flex-start", borderRadius: 8, padding: 3 },
  segmentBtn: { borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6 },
  segmentText: { fontSize: 13, fontWeight: "600" },
  summary: { marginTop: 0 },
  actions: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 4,
  },
  noticeDock: { position: "absolute", left: 0, right: 0, bottom: 24 },
});
