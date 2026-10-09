import { useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { Redirect, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { AlertText } from "../../../components/AlertText";
import { AppHeader, useMeasuredAppHeaderHeight } from "../../../components/AppHeader";
import { DeadlineRing } from "../../../components/DeadlineRing";
import { Kicker } from "../../../components/Kicker";
import { ScreenErrorBoundary } from "../../../components/ScreenErrorBoundary";
import { ScreenErrorState } from "../../../components/ScreenErrorState";
import { SkeletonList } from "../../../components/Skeleton";
import { TapPressable } from "../../../components/TapPressable";
import {
  ApiError,
  useDeleteManuscriptTargetMutation,
  useSaveManuscriptTargetMutation,
} from "../../../lib/api";
import { announce } from "../../../lib/announce";
import { getAnalytics } from "../../../lib/analytics-client";
import { addDays, daysBetween, suggestedWordGoal } from "../../../lib/deadline-pace";
import { dueText, formatCount, formatDueDate, verdictText } from "../../../lib/deadline-text";
import { useSession } from "../../../lib/session";
import { useAppTheme } from "../../../lib/settings";
import { useDeadline } from "../../../lib/use-deadline";
import { useStackBack } from "../../../lib/use-stack-back";
import { writingDayKey } from "../../../lib/writing-day";

/** A deadline given no date starts a month out. */
const DEFAULT_DAYS_AHEAD = 30;
const RING = 168;

function parseWordGoal(text: string): number | null {
  const digits = text.replace(/[\s,._]/g, "");
  if (!/^\d+$/.test(digits)) return null;
  const value = Number(digits);
  return Number.isSafeInteger(value) && value >= 1 ? value : null;
}

function dayToDate(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export default function DeadlineScreen() {
  return (
    <ScreenErrorBoundary>
      <DeadlineScreenContent />
    </ScreenErrorBoundary>
  );
}

function DeadlineScreenContent() {
  const { backOr } = useStackBack();
  const { t, i18n } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, ready } = useSession();
  const { layout, colors, dark } = useAppTheme();
  const [headerHeight, onHeaderHeight] = useMeasuredAppHeaderHeight();
  const projectId = typeof id === "string" ? id : "";
  const deadline = useDeadline(projectId);
  const saveTarget = useSaveManuscriptTargetMutation();
  const removeTarget = useDeleteManuscriptTargetMutation();
  const today = writingDayKey();
  const { target, snapshot, manuscriptWords } = deadline;

  const initial = useMemo(
    () =>
      target
        ? { goal: String(target.wordGoal), date: target.deadline }
        : { goal: String(suggestedWordGoal(manuscriptWords)), date: addDays(today, DEFAULT_DAYS_AHEAD) },
    [target, manuscriptWords, today]
  );
  const [draft, setDraft] = useState<{ goal: string; date: string } | null>(null);
  const form = draft ?? initial;
  const [error, setError] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [androidPickerOpen, setAndroidPickerOpen] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const parsedGoal = parseWordGoal(form.goal);
  const dirty = !target || form.goal !== initial.goal || form.date !== initial.date;
  const busy = saveTarget.isPending || removeTarget.isPending;

  // The save lands in the cache a render before the ring and the verdict
  // change, so say how it is going once the new numbers are on screen.
  useEffect(() => {
    if (!justSaved || !snapshot) return;
    setJustSaved(false);
    announce(`${t("deadline.saved")} ${verdictText(t, snapshot, i18n.language)}`);
  }, [justSaved, snapshot, t, i18n.language]);

  if (!ready) return null;
  if (!user) return <Redirect href="/login" />;
  if (!projectId) return <Redirect href="/manuscripts" />;

  async function save() {
    if (busy) return;
    if (parsedGoal === null) {
      setError(t("deadline.targetInvalid"));
      return;
    }
    setError(null);
    setConfirmingRemove(false);
    try {
      await saveTarget.mutateAsync({ projectId, body: { wordGoal: parsedGoal, deadline: form.date } });
      getAnalytics().track("deadline_saved", {
        created: !target,
        daysAhead: Math.max(0, daysBetween(today, form.date)),
      });
      setDraft(null);
      setJustSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("deadline.saveError"));
    }
  }

  async function remove() {
    if (busy) return;
    setError(null);
    try {
      await removeTarget.mutateAsync(projectId);
      getAnalytics().track("deadline_removed", {});
      setConfirmingRemove(false);
      setDraft(null);
      announce(t("deadline.removed"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("deadline.removeError"));
    }
  }

  function onPickDate(event: DateTimePickerEvent, picked?: Date) {
    if (Platform.OS === "android") setAndroidPickerOpen(false);
    if (event.type !== "set" || !picked) return;
    setDraft({ ...form, date: writingDayKey(picked) });
  }

  const dateLabel = formatDueDate(form.date, i18n.language);
  const complete = snapshot?.status === "complete";

  return (
    <KeyboardAvoidingView style={layout.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <AppHeader
        title={t("deadline.title")}
        onBack={() => backOr(`/project/${projectId}/chapters`)}
        floating
        onHeightChange={onHeaderHeight}
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: headerHeight + 8, paddingBottom: 48 }}
        scrollIndicatorInsets={{ top: headerHeight }}
      >
        {deadline.error && !target ? (
          <ScreenErrorState variant="full" message={t("deadline.loadError")} onRetry={deadline.refetch} />
        ) : !deadline.loaded ? (
          <SkeletonList count={3} accessibilityLabel={t("common.loading")} />
        ) : (
          <>
            {snapshot ? (
              <View testID="deadline-summary">
                <View style={styles.ringRow}>
                  <DeadlineRing progress={snapshot.progress} complete={complete} size={RING} strokeWidth={8} />
                </View>
                <Text style={[layout.cardTitle, styles.centered, { marginTop: 16 }]}>
                  {complete ? t("deadline.status.complete") : dueText(t, snapshot)}
                </Text>
                <Text style={[layout.cardMeta, styles.centered]}>
                  {t("deadline.progress", {
                    written: formatCount(snapshot.manuscriptWords, i18n.language),
                    goal: formatCount(snapshot.wordGoal, i18n.language),
                  })}
                </Text>
                <Kicker label={t("deadline.kicker")} />
                <View style={[layout.card, { marginTop: 0, marginBottom: 24 }]}>
                  <Text
                    testID="deadline-verdict"
                    style={{ color: colors.ink, fontSize: 16, lineHeight: 24 }}
                    accessibilityRole="text"
                  >
                    {verdictText(t, snapshot, i18n.language)}
                  </Text>
                </View>
              </View>
            ) : (
              <Text style={[layout.body, { marginBottom: 16 }]}>{t("deadline.blurb")}</Text>
            )}

            <Text style={[sectionLabel, { color: colors.inkSoft }]}>{t("deadline.targetLabel")}</Text>
            <TextInput
              testID="deadline-target-input"
              style={[layout.input, { marginBottom: 6 }]}
              value={form.goal}
              onChangeText={(goal) => {
                setError(null);
                setDraft({ ...form, goal });
              }}
              keyboardType="number-pad"
              maxLength={9}
              returnKeyType="done"
              aria-label={t("deadline.targetA11y")}
              placeholderTextColor={colors.inkSoft}
            />
            <Text style={{ marginBottom: 6, fontSize: 14, lineHeight: 20, color: colors.inkSoft }}>
              {t("deadline.targetHint", {
                count: manuscriptWords,
                words: formatCount(manuscriptWords, i18n.language),
              })}
            </Text>

            <View style={styles.dueRow}>
              <Text style={{ fontSize: 17, color: colors.ink }}>{t("deadline.dueLabel")}</Text>
              {Platform.OS === "android" ? (
                <TapPressable
                  accessibilityRole="button"
                  accessibilityLabel={t("deadline.dueA11y", { date: dateLabel })}
                  onPress={() => setAndroidPickerOpen(true)}
                  style={[styles.dateButton, { backgroundColor: colors.panel, borderColor: colors.line }]}
                >
                  <Text style={{ color: colors.ink, fontSize: 17 }}>{dateLabel}</Text>
                </TapPressable>
              ) : (
                <DateTimePicker
                  testID="deadline-date-picker"
                  mode="date"
                  display="compact"
                  value={dayToDate(form.date)}
                  onChange={onPickDate}
                  minimumDate={dayToDate(form.date < today ? form.date : today)}
                  themeVariant={dark ? "dark" : "light"}
                  accentColor={colors.accent}
                  accessibilityLabel={t("deadline.dueA11y", { date: dateLabel })}
                />
              )}
            </View>
            {Platform.OS === "android" && androidPickerOpen ? (
              <DateTimePicker mode="date" value={dayToDate(form.date)} onChange={onPickDate} />
            ) : null}

            {error ? (
              <AlertText style={layout.error} role="alert">
                {error}
              </AlertText>
            ) : null}

            <TapPressable
              testID="deadline-save"
              style={[layout.primaryBtn, { marginTop: 20, opacity: busy || !dirty ? 0.5 : 1 }]}
              disabled={busy || !dirty}
              onPress={() => void save()}
              accessibilityRole="button"
              accessibilityState={{ disabled: busy || !dirty, busy: saveTarget.isPending }}
            >
              <Text style={layout.primaryBtnText}>
                {saveTarget.isPending ? t("deadline.saving") : target ? t("deadline.saveChanges") : t("deadline.set")}
              </Text>
            </TapPressable>

            {target ? (
              confirmingRemove ? (
                <View style={{ marginTop: 20 }}>
                  <Text style={{ fontSize: 15, lineHeight: 22, color: colors.ink }}>{t("deadline.removeConfirm")}</Text>
                  <View style={{ flexDirection: "row", gap: 24, marginTop: 12 }}>
                    <TapPressable
                      feedback="dim"
                      disabled={busy}
                      accessibilityRole="button"
                      accessibilityLabel={t("deadline.removeYes")}
                      onPress={() => void remove()}
                    >
                      <Text style={{ color: colors.danger, fontSize: 16 }}>{t("deadline.removeYes")}</Text>
                    </TapPressable>
                    <TapPressable
                      feedback="dim"
                      accessibilityRole="button"
                      accessibilityLabel={t("common.cancel")}
                      onPress={() => setConfirmingRemove(false)}
                    >
                      <Text style={{ color: colors.inkSoft, fontSize: 16 }}>{t("common.cancel")}</Text>
                    </TapPressable>
                  </View>
                </View>
              ) : (
                <TapPressable
                  testID="deadline-remove"
                  feedback="dim"
                  style={{ marginTop: 20, alignItems: "center", paddingVertical: 8 }}
                  accessibilityRole="button"
                  onPress={() => setConfirmingRemove(true)}
                >
                  <Text style={{ color: colors.danger, fontSize: 16 }}>{t("deadline.remove")}</Text>
                </TapPressable>
              )
            ) : null}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const sectionLabel = { marginTop: 18, marginBottom: 6, fontSize: 13, fontWeight: "600" as const };

const styles = StyleSheet.create({
  ringRow: { alignItems: "center", marginTop: 8 },
  centered: { textAlign: "center" },
  dueRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 14, minHeight: 44 },
  dateButton: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
});
