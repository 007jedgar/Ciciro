import { useMemo, useState } from "react";
import { Platform, Switch, Text, View } from "react-native";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useTranslation } from "react-i18next";
import { useOptionalAppTheme } from "../lib/settings";
import { switchColors } from "../lib/switch-theme";
import { colors as parchmentColors, layout as parchmentLayout } from "../lib/theme";
import {
  REMINDER_WORD_GOALS,
  WEEKDAYS,
  formatReminderClock,
  reminderNotificationText,
  toggleReminderDay,
  type ReminderTranslate,
  type Weekday,
  type WritingReminder,
} from "../lib/writing-reminders";
import { PressableCard } from "./PressableCard";
import { SelectChip, SelectLabel } from "./SelectChip";
import { TapPressable } from "./TapPressable";
import { AlertText } from "./AlertText";
import { ChoiceRow } from "./ChoiceRow";

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export type ManuscriptChoice = { id: string; title: string };

export function WritingReminderForm({
  reminder,
  manuscripts,
  manuscriptsReady = true,
  fallbackTitle = null,
  busy = false,
  notice = null,
  externalError = null,
  openSettingsLabel = null,
  suggestedHour = null,
  onOpenSettings,
  onSave,
  onDelete,
  onboarding = false,
}: {
  reminder: WritingReminder;
  manuscripts: ManuscriptChoice[];
  /** False while the projects query has not resolved to an array. */
  manuscriptsReady?: boolean;
  /** Route-provided title used for preview while manuscripts are still loading. */
  fallbackTitle?: string | null;
  busy?: boolean;
  notice?: string | null;
  externalError?: string | null;
  openSettingsLabel?: string | null;
  /** Median sitting start hour; offered once until accepted or dismissed. */
  suggestedHour?: number | null;
  onOpenSettings?: () => void;
  onSave: (next: WritingReminder) => void;
  onDelete?: () => void;
  /**
   * The pre-signup onboarding's reminder step: a person with no manuscripts yet,
   * so no blurb (the screen has its own), no scope choice (it is for all their
   * writing), no pause switch, and the button reads "Create reminder".
   */
  onboarding?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const themed = useOptionalAppTheme();
  const dark = themed?.dark ?? false;
  const layout = themed?.layout ?? parchmentLayout;
  const colors = themed?.colors ?? parchmentColors;
  const chipTokens = {
    restFill: colors.panel,
    activeFill: colors.accent,
    restBorder: colors.line,
    activeBorder: colors.accent,
    restText: colors.ink,
    activeText: colors.panel,
  };
  const translate: ReminderTranslate = (key, options) => String(t(key, options));

  const [projectId, setProjectId] = useState<string | null>(reminder.projectId);
  const [wordGoal, setWordGoal] = useState<number | null>(reminder.wordGoal);
  const [hour, setHour] = useState(reminder.hour);
  const [minute, setMinute] = useState(reminder.minute);
  const [days, setDays] = useState<Weekday[]>(reminder.days);
  const [enabled, setEnabled] = useState(reminder.enabled);
  const [openSprint, setOpenSprint] = useState(reminder.openSprint);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [androidPickerOpen, setAndroidPickerOpen] = useState(false);
  const [dismissedSuggestion, setDismissedSuggestion] = useState(false);

  const goals = useMemo(() => {
    const choices: number[] = [...REMINDER_WORD_GOALS];
    if (wordGoal != null && !choices.includes(wordGoal)) choices.push(wordGoal);
    return choices.sort((a, b) => a - b);
  }, [wordGoal]);

  const known = manuscripts.some((manuscript) => manuscript.id === projectId);
  const listedTitle = manuscripts.find((manuscript) => manuscript.id === projectId)?.title;
  const previewTitle =
    projectId == null
      ? null
      : listedTitle ??
        (!manuscriptsReady ? fallbackTitle?.trim() || null : undefined);
  const preview =
    projectId != null && !manuscriptsReady && previewTitle == null
      ? { title: t("reminders.title"), body: "" }
      : reminderNotificationText(
          { projectId, wordGoal },
          previewTitle === undefined ? undefined : previewTitle,
          translate
        );
  const clock = formatReminderClock(hour, minute, i18n.language);
  const shownError = error ?? externalError;
  const showHourSuggestion =
    suggestedHour != null &&
    !dismissedSuggestion &&
    suggestedHour !== hour &&
    Number.isInteger(suggestedHour) &&
    suggestedHour >= 0 &&
    suggestedHour <= 23;
  const suggestedClock = showHourSuggestion
    ? formatReminderClock(suggestedHour!, 0, i18n.language)
    : null;

  // The picker works in device-local wall-clock time; only hour and minute are read back.
  const pickerValue = new Date(2020, 0, 1, hour, minute);

  function onPickTime(event: DateTimePickerEvent, picked?: Date) {
    if (Platform.OS === "android") setAndroidPickerOpen(false);
    if (event.type !== "set" || !picked) return;
    setHour(picked.getHours());
    setMinute(picked.getMinutes());
  }

  function save() {
    if (busy) return;
    if (days.length === 0) {
      setError(t("reminders.daysRequired"));
      return;
    }
    setError(null);
    setConfirmingDelete(false);
    onSave({
      id: reminder.id,
      projectId,
      wordGoal,
      hour,
      minute,
      days,
      enabled,
      openSprint: projectId != null && openSprint,
    });
  }

  return (
    <View>
      {onboarding ? null : <Text style={[layout.body, { marginBottom: 16 }]}>{t("reminders.blurb")}</Text>}

      <Text style={[sectionLabel, { color: colors.inkSoft }]}>{t("reminders.preview")}</Text>
      <View
        style={{
          backgroundColor: colors.panel,
          borderColor: colors.line,
          borderWidth: 1,
          borderRadius: 16,
          padding: 16,
          marginBottom: 8,
        }}
      >
        <Text style={{ fontSize: 17, fontWeight: "600", color: colors.ink }}>{preview.title}</Text>
        <Text style={{ marginTop: 4, fontSize: 15, lineHeight: 21, color: colors.inkSoft }}>
          {preview.body}
        </Text>
        {enabled ? null : (
          <Text style={{ marginTop: 8, fontSize: 13, color: colors.inkSoft }}>
            {t("reminders.paused")}
          </Text>
        )}
      </View>

      {onboarding ? null : (
        <>
          <Text style={[sectionLabel, { color: colors.inkSoft }]}>{t("reminders.scope")}</Text>
          <ChoiceRow
            label={t("reminders.general")}
            selected={projectId == null}
            colors={colors}
            onPress={() => setProjectId(null)}
          />
          {manuscripts.map((manuscript) => (
            <ChoiceRow
              key={manuscript.id}
              label={manuscript.title}
              selected={projectId === manuscript.id}
              colors={colors}
              onPress={() => setProjectId(manuscript.id)}
            />
          ))}
          {projectId && !known && manuscriptsReady ? (
            <ChoiceRow
              label={t("reminders.missingManuscript")}
              selected
              colors={colors}
              onPress={() => setProjectId(projectId)}
            />
          ) : null}
        </>
      )}

      <Text style={[sectionLabel, { color: colors.inkSoft }]}>{t("reminders.goal")}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {[null, ...goals].map((goal) => {
          const selected = goal === wordGoal;
          const label = goal == null ? t("reminders.noGoal") : t("reminders.goalValue", { count: goal });
          return (
            <SelectChip
              key={goal ?? "none"}
              selected={selected}
              tokens={chipTokens}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={label}
              onPress={() => setWordGoal(goal)}
              surfaceStyle={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, borderWidth: 1 }}
            >
              <SelectLabel style={{ fontSize: 15 }}>{label}</SelectLabel>
            </SelectChip>
          );
        })}
      </View>

      <View style={{ height: 18 }} />
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ fontSize: 17, color: colors.ink }}>{t("reminders.when")}</Text>
        {Platform.OS === "android" ? (
          <TapPressable
            accessibilityRole="button"
            accessibilityLabel={t("reminders.timeA11y", { time: clock })}
            onPress={() => setAndroidPickerOpen(true)}
            style={[timeButton, { backgroundColor: colors.panel, borderColor: colors.line }]}
          >
            <Text style={{ color: colors.ink, fontSize: 22 }}>{clock}</Text>
          </TapPressable>
        ) : (
          <DateTimePicker
            testID="reminder-time-picker"
            mode="time"
            display="compact"
            value={pickerValue}
            onChange={onPickTime}
            minuteInterval={1}
            themeVariant={dark ? "dark" : "light"}
            accentColor={colors.accent}
            accessibilityLabel={t("reminders.timeA11y", { time: clock })}
          />
        )}
      </View>
      {Platform.OS === "android" && androidPickerOpen ? (
        <DateTimePicker mode="time" value={pickerValue} onChange={onPickTime} />
      ) : null}

      {showHourSuggestion && suggestedClock ? (
        <View
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 12,
            backgroundColor: colors.panel,
            borderWidth: 1,
            borderColor: colors.line,
          }}
        >
          <Text style={{ fontSize: 15, color: colors.ink, lineHeight: 22 }}>
            {t("reminders.suggestHour", { time: suggestedClock })}
          </Text>
          <View style={{ flexDirection: "row", gap: 16, marginTop: 10 }}>
            <TapPressable
              feedback="dim"
              accessibilityRole="button"
              accessibilityLabel={t("reminders.suggestHourAccept")}
              onPress={() => {
                setHour(suggestedHour!);
                setMinute(0);
                setDismissedSuggestion(true);
              }}
            >
              <Text style={{ color: colors.accent, fontSize: 16 }}>
                {t("reminders.suggestHourAccept")}
              </Text>
            </TapPressable>
            <TapPressable
              feedback="dim"
              accessibilityRole="button"
              accessibilityLabel={t("reminders.suggestHourDismiss")}
              onPress={() => setDismissedSuggestion(true)}
            >
              <Text style={{ color: colors.inkSoft, fontSize: 16 }}>
                {t("reminders.suggestHourDismiss")}
              </Text>
            </TapPressable>
          </View>
        </View>
      ) : null}

      <Text style={[sectionLabel, { color: colors.inkSoft }]}>{t("reminders.days")}</Text>
      <View style={{ flexDirection: "row", gap: 6 }}>
        {WEEKDAYS.map((day) => {
          const selected = days.includes(day);
          const name = t(`reminders.day.${DAY_KEYS[day]}`);
          return (
            <SelectChip
              key={day}
              selected={selected}
              tokens={chipTokens}
              accessibilityRole="button"
              accessibilityLabel={name}
              accessibilityState={{ selected }}
              onPress={() => setDays(toggleReminderDay(days, day))}
              style={{ flex: 1 }}
              surfaceStyle={{
                minHeight: 44,
                borderRadius: 12,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
              }}
            >
              <SelectLabel style={{ fontSize: 13 }}>{t(`reminders.dayShort.${DAY_KEYS[day]}`)}</SelectLabel>
            </SelectChip>
          );
        })}
      </View>

      {onboarding ? null : (
        <View
          style={{
            marginTop: 20,
            minHeight: 52,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 17, color: colors.ink }}>{t("reminders.enabled")}</Text>
            <Text style={{ marginTop: 3, fontSize: 13, lineHeight: 18, color: colors.inkSoft }}>
              {t("reminders.enabledHint")}
            </Text>
          </View>
          <Switch
            value={enabled}
            onValueChange={setEnabled}
            {...switchColors(colors)}
            accessibilityLabel={t("reminders.enabled")}
          />
        </View>
      )}

      {projectId ? (
        <View
          style={{
            marginTop: 12,
            minHeight: 52,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 17, color: colors.ink }}>{t("reminders.openSprint")}</Text>
            <Text style={{ marginTop: 3, fontSize: 13, lineHeight: 18, color: colors.inkSoft }}>
              {t("reminders.openSprintHint")}
            </Text>
          </View>
          <Switch
            value={openSprint}
            onValueChange={setOpenSprint}
            {...switchColors(colors)}
            accessibilityLabel={t("reminders.openSprint")}
          />
        </View>
      ) : null}

      {shownError ? (
        <AlertText style={layout.error} role="alert">
          {shownError}
        </AlertText>
      ) : null}
      {notice ? (
        <Text style={[layout.body, { marginTop: 12 }]} accessibilityRole="text">
          {notice}
        </Text>
      ) : null}
      {openSettingsLabel && onOpenSettings ? (
        <TapPressable
          style={layout.ghostBtn}
          onPress={onOpenSettings}
          accessibilityRole="button"
          accessibilityLabel={openSettingsLabel}
        >
          <Text style={layout.ghostBtnText}>{openSettingsLabel}</Text>
        </TapPressable>
      ) : null}

      <PressableCard
        accent
        style={[layout.primaryBtn, { marginTop: 16, opacity: busy ? 0.6 : 1 }]}
        onPress={save}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={onboarding ? t("onboarding.reminderCreate") : t("reminders.save")}
      >
        <Text style={layout.primaryBtnText}>
          {busy ? t("reminders.saving") : onboarding ? t("onboarding.reminderCreate") : t("reminders.save")}
        </Text>
      </PressableCard>

      {onDelete ? (
        <TapPressable
          style={layout.ghostBtn}
          onPress={() => {
            if (!confirmingDelete) {
              setConfirmingDelete(true);
              return;
            }
            onDelete();
          }}
          accessibilityRole="button"
          accessibilityLabel={
            confirmingDelete ? t("reminders.deleteConfirm") : t("reminders.delete")
          }
        >
          <Text style={[layout.ghostBtnText, { color: colors.danger }]}>
            {confirmingDelete ? t("reminders.deleteConfirm") : t("reminders.delete")}
          </Text>
        </TapPressable>
      ) : null}
    </View>
  );
}

const sectionLabel = { marginTop: 18, marginBottom: 8, fontSize: 13, fontWeight: "600" as const };
const timeButton = {
  minHeight: 44,
  paddingHorizontal: 16,
  borderRadius: 14,
  borderWidth: 1,
  alignItems: "center" as const,
  justifyContent: "center" as const,
};
