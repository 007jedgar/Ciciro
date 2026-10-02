import { useEffect, useRef, useState } from "react";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { AccessibilityInfo, Alert, Pressable, Share, StyleSheet, Text, TextInput, View } from "react-native";
import Animated, { FadeInDown, LinearTransition, SlideOutLeft } from "react-native-reanimated";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useTranslation } from "react-i18next";
import {
  ApiError,
  useCreateShareLinkMutation,
  useDeleteShareLinkMutation,
  useRevokeShareLinkMutation,
  useShareLinksQuery,
} from "../lib/api";
import type { ShareLinkSummary } from "../lib/api/types";
import { chapterNumberLabel, customChapterTitle } from "../lib/chapter-label";
import { SHARE_EXPIRY_PRESETS, SHARE_LABEL_MAX, shareLinkUrl, type ShareExpiryPreset } from "../lib/shares";
import { useAppTheme } from "../lib/settings";
import { fadeUpDelay } from "../lib/skeleton";
import { useUndoableRemoval } from "../lib/undo-removal";
import { useReduceMotion } from "../lib/use-reduce-motion";
import { SkeletonList } from "./Skeleton";
import { UndoSnackbar } from "./UndoSnackbar";
import { getAnalytics } from "../lib/analytics-client";

export type ShareLinksHost = {
  alert: typeof Alert.alert;
  share: (content: { message: string; url?: string }) => Promise<unknown>;
};

const defaultHost: ShareLinksHost = {
  alert: Alert.alert,
  share: (content) => Share.share(content),
};

/** Make read-only links for beta readers, hand them out, and turn them off. */
export function ShareLinks({
  projectId,
  projectTitle,
  chapters,
  host = defaultHost,
}: {
  projectId: string;
  projectTitle: string;
  /** The manuscript's chapters in order. */
  chapters: { id: string; title: string }[];
  host?: ShareLinksHost;
}) {
  const { t, i18n } = useTranslation();
  const { colors, layout, settings } = useAppTheme();
  const links = useShareLinksQuery(projectId);
  const create = useCreateShareLinkMutation();
  const revoke = useRevokeShareLinkMutation();
  const remove = useDeleteShareLinkMutation();
  const [label, setLabel] = useState("");
  const [scope, setScope] = useState<"all" | "some">("all");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [expiry, setExpiry] = useState<ShareExpiryPreset>(30);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reduceMotion = useReduceMotion();
  const { hidden, notice, remove: removeWithUndo, undo } = useUndoableRemoval({
    onFailed: (_id, err) => setError(err instanceof ApiError ? err.message : t("beta.links.actionError")),
  });
  const busy = revoke.isPending || remove.isPending;

  function chapterName(index: number): string {
    const numbered = chapterNumberLabel(index + 1, (key, opts) => t(key, opts));
    const custom = customChapterTitle(chapters[index]?.title, numbered, t("chapters.newTitle"));
    return custom ? `${numbered} · ${custom}` : numbered;
  }

  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language, { month: "short", day: "numeric" });

  async function shareLink(link: ShareLinkSummary) {
    const url = shareLinkUrl(link);
    try {
      await host.share({ message: t("beta.links.shareMessage", { title: projectTitle, url }), url });
    } catch {
      // Dismissing the share sheet is not an error worth showing.
    }
  }

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  async function copyUrl(link: ShareLinkSummary) {
    try {
      await Clipboard.setStringAsync(shareLinkUrl(link));
    } catch {
      setError(t("beta.links.copyError"));
      return;
    }
    setError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    AccessibilityInfo.announceForAccessibility(t("beta.links.copied"));
    setCopiedId(link.id);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopiedId(null), 2000);
  }

  async function make() {
    if (create.isPending) return;
    if (scope === "some" && picked.size === 0) {
      setError(t("beta.links.pickChapters"));
      return;
    }
    setError(null);
    try {
      const link = await create.mutateAsync({
        projectId,
        body: {
          label,
          chapterIds: scope === "some" ? chapters.filter((c) => picked.has(c.id)).map((c) => c.id) : [],
          expiresInDays: expiry,
        },
      });
      getAnalytics().track("share_link_created", {});
      setLabel("");
      setPicked(new Set());
      setScope("all");
      void shareLink(link);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("beta.links.createError"));
    }
  }

  function confirmRevoke(link: ShareLinkSummary) {
    host.alert(t("beta.links.revokeTitle"), t("beta.links.revokeMessage"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("beta.links.revoke"),
        style: "destructive",
        onPress: () => {
          setError(null);
          revoke.mutateAsync({ projectId, linkId: link.id }).catch((err: unknown) => {
            setError(err instanceof ApiError ? err.message : t("beta.links.actionError"));
          });
        },
      },
    ]);
  }

  // A link with reader comments takes them with it, so that asks first. An
  // empty one slides out and Undo stays up for a few seconds.
  function removeLink(link: ShareLinkSummary) {
    setError(null);
    if (link.commentCount === 0) {
      removeWithUndo(link.id, t("beta.links.linkRemoved"), () => remove.mutateAsync({ projectId, linkId: link.id }));
      return;
    }
    host.alert(t("beta.links.deleteTitle"), t("beta.links.deleteMessage", { count: link.commentCount }), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: () => {
          remove.mutateAsync({ projectId, linkId: link.id }).catch((err: unknown) => {
            setError(err instanceof ApiError ? err.message : t("beta.links.actionError"));
          });
        },
      },
    ]);
  }

  function statusLine(link: ShareLinkSummary): string {
    const scopeText =
      link.chapterIds.length === 0
        ? t("beta.links.scopeWhole")
        : t("beta.links.scopeChapters", { count: link.chapterIds.length });
    const when =
      link.status === "revoked" && link.revokedAt
        ? t("beta.links.revokedOn", { date: date(link.revokedAt) })
        : link.expiresAt
          ? t(link.status === "expired" ? "beta.links.expiredOn" : "beta.links.expiresOn", {
              date: date(link.expiresAt),
            })
          : t("beta.links.neverExpires");
    return [scopeText, when, t("beta.links.comments", { count: link.commentCount })].join(" · ");
  }

  const visibleLinks = (links.data ?? []).filter((l) => !hidden.has(l.id));

  const chip = (active: boolean) => [
    styles.chip,
    { borderColor: active ? colors.accent : colors.line, backgroundColor: active ? colors.accentSoft : "transparent" },
  ];
  const chipText = (active: boolean) => [styles.chipText, { color: active ? colors.ink : colors.inkSoft }];

  return (
    <View style={styles.root}>
    <KeyboardAwareScrollView
      testID="share-links"
      style={{ flex: 1 }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[layout.body, styles.blurb]}>{t("beta.links.blurb")}</Text>

      <Text style={[layout.cardMeta, styles.label]}>{t("beta.links.labelLabel")}</Text>
      <TextInput
        style={layout.input}
        aria-label={t("beta.links.labelLabel")}
        placeholder={t("beta.links.labelPlaceholder")}
        placeholderTextColor={colors.inkSoft}
        value={label}
        onChangeText={setLabel}
        maxLength={SHARE_LABEL_MAX}
        autoCorrect={settings.autoCorrect}
      />

      <Text style={[layout.cardMeta, styles.label]}>{t("beta.links.what")}</Text>
      <View style={styles.chips}>
        {(["all", "some"] as const).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="radio"
            accessibilityState={{ checked: scope === value }}
            onPress={() => setScope(value)}
            style={chip(scope === value)}
          >
            <Text style={chipText(scope === value)}>
              {t(value === "all" ? "beta.links.whole" : "beta.links.chosen")}
            </Text>
          </Pressable>
        ))}
      </View>
      {scope === "some" ? (
        <View style={[styles.picks, { borderColor: colors.line }]}>
          {chapters.map((chapter, index) => {
            const on = picked.has(chapter.id);
            return (
              <Pressable
                key={chapter.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={chapterName(index)}
                onPress={() =>
                  setPicked((prev) => {
                    const next = new Set(prev);
                    if (on) next.delete(chapter.id);
                    else next.add(chapter.id);
                    return next;
                  })
                }
                style={styles.pick}
              >
                <View
                  style={[
                    styles.box,
                    { borderColor: on ? colors.accent : colors.inkSoft, backgroundColor: on ? colors.accent : "transparent" },
                  ]}
                >
                  {on ? <Text style={[styles.tick, { color: colors.panel }]}>✓</Text> : null}
                </View>
                <Text style={[layout.body, styles.pickText]} numberOfLines={1}>
                  {chapterName(index)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <Text style={[layout.cardMeta, styles.label]}>{t("beta.links.expires")}</Text>
      <View style={[styles.segment, { backgroundColor: colors.panel2 }]}>
        {SHARE_EXPIRY_PRESETS.map((days) => {
          const active = expiry === days;
          return (
            <Pressable
              key={days ?? "never"}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              onPress={() => setExpiry(days)}
              style={[styles.segmentBtn, active ? { backgroundColor: colors.panel } : null]}
            >
              <Text style={[styles.segmentText, { color: active ? colors.ink : colors.inkSoft }]}>
                {days === null ? t("beta.links.never") : t("beta.links.days", { count: days })}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("beta.links.create")}
        accessibilityState={{ disabled: create.isPending }}
        disabled={create.isPending}
        onPress={() => void make()}
        style={[styles.primaryBtn, { backgroundColor: colors.accent, opacity: create.isPending ? 0.5 : 1 }]}
      >
        <Text style={[styles.primaryBtnText, { color: colors.panel }]}>
          {create.isPending ? t("beta.links.creating") : t("beta.links.create")}
        </Text>
      </Pressable>

      {error ? (
        <Text style={[layout.error, styles.error]} role="alert">
          {error}
        </Text>
      ) : null}
      {links.isError ? (
        <Text style={[layout.error, styles.error]} role="alert">
          {t("beta.links.loadError")}
        </Text>
      ) : null}

      <View style={[styles.rule, { backgroundColor: colors.line }]} />
      {links.isPending && !links.data ? <SkeletonList count={2} accessibilityLabel={t("common.loading")} /> : null}
      {links.data && visibleLinks.length === 0 ? <Text style={layout.body}>{t("beta.links.empty")}</Text> : null}
      {visibleLinks.map((link, index) => {
        const active = link.status === "active";
        return (
          <Animated.View
            key={link.id}
            testID={`share-link-${link.id}`}
            style={[layout.card, styles.card, active ? null : styles.inactive]}
            exiting={reduceMotion ? undefined : SlideOutLeft.duration(200)}
            entering={reduceMotion ? undefined : FadeInDown.duration(240).delay(fadeUpDelay(index))}
            layout={reduceMotion ? undefined : LinearTransition.duration(200)}
          >
            <View style={styles.cardHead}>
              <Text style={[layout.cardTitle, styles.cardTitle]} numberOfLines={1}>
                {link.label || t("beta.links.untitled")}
              </Text>
              <Text
                style={[
                  styles.pill,
                  { color: active ? colors.accent : colors.inkSoft, borderColor: active ? colors.accent : colors.line },
                ]}
              >
                {t(`beta.links.${link.status}`)}
              </Text>
            </View>
            <Text style={layout.cardMeta}>{statusLine(link)}</Text>
            {active ? (
              <Pressable
                onPress={() => void copyUrl(link)}
                accessibilityRole="button"
                accessibilityLabel={t("beta.links.copyUrl")}
                accessibilityHint={t("beta.links.copyUrlHint")}
                style={styles.urlRow}
              >
                <Text style={[styles.url, styles.urlText, { color: colors.inkSoft }]} numberOfLines={1}>
                  {shareLinkUrl(link)}
                </Text>
                {copiedId === link.id ? (
                  <Text style={[styles.url, styles.copied, { color: colors.accent }]}>{t("beta.links.copied")}</Text>
                ) : null}
              </Pressable>
            ) : null}
            <View style={styles.actions}>
              {active ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void shareLink(link)}
                  style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
                >
                  <Text style={[styles.primaryBtnText, { color: colors.panel }]}>{t("beta.links.share")}</Text>
                </Pressable>
              ) : null}
              <View style={styles.spacer} />
              {active ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => confirmRevoke(link)}
                  disabled={busy}
                  hitSlop={12}
                  style={({ pressed }) => [styles.ghostBtn, { opacity: busy ? 0.4 : pressed ? 0.6 : 1 }]}
                >
                  <Text style={[styles.ghostBtnText, { color: colors.inkSoft }]}>{t("beta.links.revoke")}</Text>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                onPress={() => removeLink(link)}
                disabled={busy}
                hitSlop={12}
                style={({ pressed }) => [styles.ghostBtn, { opacity: busy ? 0.4 : pressed ? 0.6 : 1 }]}
              >
                <Text style={[styles.ghostBtnText, { color: colors.danger }]}>{t("common.delete")}</Text>
              </Pressable>
            </View>
          </Animated.View>
        );
      })}
    </KeyboardAwareScrollView>
    <UndoSnackbar message={notice?.message ?? null} onUndo={undo} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 64 },
  blurb: { marginBottom: 16 },
  label: { marginTop: 4, marginBottom: 6, fontWeight: "600" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  chipText: { fontSize: 14, fontWeight: "500" },
  segment: { flexDirection: "row", alignSelf: "flex-start", borderRadius: 8, padding: 3, marginBottom: 14 },
  segmentBtn: { borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6 },
  segmentText: { fontSize: 13, fontWeight: "600" },
  picks: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 10, gap: 4, marginTop: -4, marginBottom: 14 },
  pick: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
  box: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  tick: { fontSize: 13, fontWeight: "700", lineHeight: 16 },
  pickText: { flex: 1, marginBottom: 0 },
  primaryBtn: { alignItems: "center", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
  primaryBtnText: { fontSize: 15, fontWeight: "600" },
  error: { marginTop: 12, marginBottom: 0 },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 20 },
  card: { marginBottom: 12, gap: 6 },
  inactive: { opacity: 0.7 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { flex: 1 },
  pill: { fontSize: 12, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, overflow: "hidden" },
  url: { fontSize: 12 },
  urlRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  urlText: { flexShrink: 1 },
  copied: { fontWeight: "600" },
  actions: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  spacer: { flex: 1 },
  ghostBtn: { paddingHorizontal: 6, paddingVertical: 8 },
  ghostBtnText: { fontSize: 15, fontWeight: "500" },
});
