import { useMemo, useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useOptionalAppTheme } from "../lib/settings";
import { colors as parchmentColors, layout as parchmentLayout } from "../lib/theme";
import {
  REMINDER_WORD_GOALS,
  WEEKDAYS,
  formatReminderClock,
  reminderNotificationText,
  shiftReminderTime,
  toggleReminderDay,
  type ReminderTranslate,
  type Weekday,
  type WritingReminder,
} from "../lib/writing-reminders";

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
}) {
  const { t, i18n } = useTranslation();
  const themed = useOptionalAppTheme();
  const layout = themed?.layout ?? parchmentLayout;
  const colors = themed?.colors ?? parchmentColors;
  const translate: ReminderTranslate = (key, options) => String(t(key, options));

  const [projectId, setProjectId] = useState<string | null>(reminder.projectId);
  const [wordGoal, setWordGoal] = useState(reminder.wordGoal);
  const [hour, setHour] = useState(reminder.hour);
  const [minute, setMinute] = useState(reminder.minute);
  const [days, setDays] = useState<Weekday[]>(reminder.days);
  const [enabled, setEnabled] = useState(reminder.enabled);
  const [openSprint, setOpenSprint] = useState(reminder.openSprint);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [dismissedSuggestion, setDismissedSuggestion] = useState(false);

  const goals = useMemo(() => {
    const choices: number[] = [...REMINDER_WORD_GOALS];
    if (!choices.includes(wordGoal)) choices.push(wordGoal);
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

  function shift(deltaMinutes: number) {
    const next = shiftReminderTime(hour, minute, deltaMinutes);
    setHour(next.hour);
    setMinute(next.minute);
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
      <Text style={[layout.body, { marginBottom: 16 }]}>{t("reminders.blurb")}</Text>

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

      <Text style={[sectionLabel, { color: colors.inkSoft }]}>{t("reminders.scope")}</Text>
      <Choice
        label={t("reminders.general")}
        selected={projectId == null}
        colors={colors}
        onPress={() => setProjectId(null)}
      />
      {manuscripts.map((manuscript) => (
        <Choice
          key={manuscript.id}
          label={manuscript.title}
          selected={projectId === manuscript.id}
          colors={colors}
          onPress={() => setProjectId(manuscript.id)}
        />
      ))}
      {projectId && !known && manuscriptsReady ? (
        <Choice
          label={t("reminders.missingManuscript")}
          selected
          colors={colors}
          onPress={() => setProjectId(projectId)}
        />
      ) : null}

      <Text style={[sectionLabel, { color: colors.inkSoft }]}>{t("reminders.goal")}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {goals.map((goal) => {
          const selected = goal === wordGoal;
          return (
            <Pressable
              key={goal}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={t("reminders.goalValue", { count: goal })}
              onPress={() => setWordGoal(goal)}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 10,
                borderRadius: 14,
                backgroundColor: selected ? colors.accent : colors.panel,
                borderWidth: 1,
                borderColor: selected ? colors.accent : colors.line,
              }}
            >
              <Text style={{ color: selected ? colors.panel : colors.ink, fontSize: 15 }}>
                {t("reminders.goalValue", { count: goal })}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={[sectionLabel, { color: colors.inkSoft }]}>{t("reminders.when")}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("reminders.earlier")}
          onPress={() => shift(-15)}
          style={[stepper, { backgroundColor: colors.panel, borderColor: colors.line }]}
        >
          <Text style={{ color: colors.ink, fontSize: 20 }}>−</Text>
        </Pressable>
        <Text
          accessibilityLabel={t("reminders.timeA11y", { time: clock })}
          style={{ flex: 1, textAlign: "center", fontSize: 22, color: colors.ink }}
        >
          {clock}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("reminders.later")}
          onPress={() => shift(15)}
          style={[stepper, { backgroundColor: colors.panel, borderColor: colors.line }]}
        >
          <Text style={{ color: colors.ink, fontSize: 20 }}>+</Text>
        </Pressable>
      </View>

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
            <Pressable
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
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("reminders.suggestHourDismiss")}
              onPress={() => setDismissedSuggestion(true)}
            >
              <Text style={{ color: colors.inkSoft, fontSize: 16 }}>
                {t("reminders.suggestHourDismiss")}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <Text style={[sectionLabel, { color: colors.inkSoft }]}>{t("reminders.days")}</Text>
      <View style={{ flexDirection: "row", gap: 6 }}>
        {WEEKDAYS.map((day) => {
          const selected = days.includes(day);
          const name = t(`reminders.day.${DAY_KEYS[day]}`);
          return (
            <Pressable
              key={day}
              accessibilityRole="button"
              accessibilityLabel={name}
              accessibilityState={{ selected }}
              onPress={() => setDays(toggleReminderDay(days, day))}
              style={{
                flex: 1,
                minHeight: 44,
                borderRadius: 12,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: selected ? colors.accent : colors.panel,
                borderWidth: 1,
                borderColor: selected ? colors.accent : colors.line,
              }}
            >
              <Text style={{ color: selected ? colors.panel : colors.ink, fontSize: 13 }}>
                {t(`reminders.dayShort.${DAY_KEYS[day]}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>

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
          trackColor={{ false: colors.line, true: colors.accent }}
          thumbColor={colors.panel}
          accessibilityLabel={t("reminders.enabled")}
        />
      </View>

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
            trackColor={{ false: colors.line, true: colors.accent }}
            thumbColor={colors.panel}
            accessibilityLabel={t("reminders.openSprint")}
          />
        </View>
      ) : null}

      {shownError ? (
        <Text style={layout.error} role="alert">
          {shownError}
        </Text>
      ) : null}
      {notice ? (
        <Text style={[layout.body, { marginTop: 12 }]} accessibilityRole="text">
          {notice}
        </Text>
      ) : null}
      {openSettingsLabel && onOpenSettings ? (
        <Pressable
          style={layout.ghostBtn}
          onPress={onOpenSettings}
          accessibilityRole="button"
          accessibilityLabel={openSettingsLabel}
        >
          <Text style={layout.ghostBtnText}>{openSettingsLabel}</Text>
        </Pressable>
      ) : null}

      <Pressable
        style={[layout.primaryBtn, { marginTop: 16, opacity: busy ? 0.6 : 1 }]}
        onPress={save}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={t("reminders.save")}
      >
        <Text style={layout.primaryBtnText}>
          {busy ? t("reminders.saving") : t("reminders.save")}
        </Text>
      </Pressable>

      {onDelete ? (
        <Pressable
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
        </Pressable>
      ) : null}
    </View>
  );
}

function Choice({
  label,
  selected,
  colors,
  onPress,
}: {
  label: string;
  selected: boolean;
  colors: { ink: string; accent: string; accentSoft: string; panel2: string; line: string };
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={{
        minHeight: 48,
        borderRadius: 14,
        paddingHorizontal: 14,
        marginBottom: 8,
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: selected ? colors.accentSoft : "transparent",
        borderWidth: 1,
        borderColor: selected ? colors.accent : colors.line,
      }}
    >
      <Text style={{ flex: 1, fontSize: 17, color: colors.ink }}>{label}</Text>
    </Pressable>
  );
}

const sectionLabel = { marginTop: 18, marginBottom: 8, fontSize: 13, fontWeight: "600" as const };
const stepper = {
  width: 44,
  height: 44,
  borderRadius: 14,
  borderWidth: 1,
  alignItems: "center" as const,
  justifyContent: "center" as const,
};
