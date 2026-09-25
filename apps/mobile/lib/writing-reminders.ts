/**
 * Writing reminders are a paid feature. Access stays open while it is in
 * testing — nothing here checks an entitlement.
 *
 * A reminder is either general writing or one manuscript. That choice is what
 * the notification says.
 */

export const REMINDER_WORD_GOALS = [100, 250, 500, 1000] as const;
export const MAX_WRITING_REMINDERS = 10;
export const REMINDER_NOTIFICATION_PREFIX = "ciciro.reminder.";
export const DEFAULT_REMINDER_WORD_GOAL = 250;
export const DEFAULT_REMINDER_HOUR = 8;
export const DEFAULT_REMINDER_MINUTE = 0;

/** Sunday is 0, matching `Date#getDay`. Expo's weekly trigger numbers Sunday as 1. */
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export type WritingReminder = {
  id: string;
  /** null is a general writing goal, not one manuscript. */
  projectId: string | null;
  wordGoal: number;
  hour: number;
  minute: number;
  days: Weekday[];
  enabled: boolean;
  /** When set with a projectId, the notification opens a sprint. */
  openSprint: boolean;
};

export type ReminderTranslate = (key: string, options?: Record<string, unknown>) => string;

export type ReminderTrigger =
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "weekly"; weekday: Weekday; hour: number; minute: number };

export type PlannedReminderNotification = {
  identifier: string;
  title: string;
  body: string;
  trigger: ReminderTrigger;
  data: {
    kind: "writing-reminder";
    reminderId: string;
    projectId: string | null;
    href: string;
  };
};

export function createWritingReminderId(
  now: number = Date.now(),
  random: () => number = Math.random
): string {
  return `wr_${now.toString(36)}_${random().toString(36).slice(2, 10)}`;
}

export function newWritingReminder(input: {
  id: string;
  projectId?: string | null;
}): WritingReminder {
  return {
    id: input.id,
    projectId: input.projectId ?? null,
    wordGoal: DEFAULT_REMINDER_WORD_GOAL,
    hour: DEFAULT_REMINDER_HOUR,
    minute: DEFAULT_REMINDER_MINUTE,
    days: [...WEEKDAYS],
    enabled: true,
    openSprint: false,
  };
}

function isWeekday(value: number): value is Weekday {
  return WEEKDAYS.some((day) => day === value);
}

export function parseWritingReminder(raw: unknown): WritingReminder | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  if (typeof src.id !== "string" || src.id.trim() === "") return null;
  if (src.projectId != null && (typeof src.projectId !== "string" || src.projectId.trim() === "")) {
    return null;
  }
  if (
    typeof src.hour !== "number" ||
    !Number.isInteger(src.hour) ||
    src.hour < 0 ||
    src.hour > 23
  ) {
    return null;
  }
  if (
    typeof src.minute !== "number" ||
    !Number.isInteger(src.minute) ||
    src.minute < 0 ||
    src.minute > 59
  ) {
    return null;
  }
  if (typeof src.wordGoal !== "number" || !Number.isFinite(src.wordGoal)) return null;
  if (!Array.isArray(src.days)) return null;
  const rawDays: unknown[] = src.days;
  const days = WEEKDAYS.filter((day) =>
    rawDays.some((value) => typeof value === "number" && value === day)
  );
  if (days.length === 0) return null;
  return {
    id: src.id,
    projectId: typeof src.projectId === "string" ? src.projectId : null,
    wordGoal: Math.min(5000, Math.max(50, Math.round(src.wordGoal))),
    hour: src.hour,
    minute: src.minute,
    days,
    enabled: src.enabled === false ? false : true,
    openSprint: src.openSprint === true && typeof src.projectId === "string",
  };
}

export function parseWritingReminders(raw: unknown): WritingReminder[] {
  if (!Array.isArray(raw)) return [];
  const reminders: WritingReminder[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const reminder = parseWritingReminder(item);
    if (!reminder || seen.has(reminder.id)) continue;
    seen.add(reminder.id);
    reminders.push(reminder);
    if (reminders.length >= MAX_WRITING_REMINDERS) break;
  }
  return reminders;
}

export function upsertWritingReminder(
  list: readonly WritingReminder[],
  reminder: WritingReminder
): { ok: true; reminders: WritingReminder[] } | { ok: false; error: "limit" | "invalid" } {
  const parsed = parseWritingReminder(reminder);
  if (!parsed) return { ok: false, error: "invalid" };
  const index = list.findIndex((item) => item.id === parsed.id);
  if (index === -1 && list.length >= MAX_WRITING_REMINDERS) return { ok: false, error: "limit" };
  const reminders = list.slice();
  if (index === -1) reminders.push(parsed);
  else reminders[index] = parsed;
  return { ok: true, reminders };
}

export function removeWritingReminder(
  list: readonly WritingReminder[],
  id: string
): WritingReminder[] {
  return list.filter((item) => item.id !== id);
}

export function shiftReminderTime(
  hour: number,
  minute: number,
  deltaMinutes: number
): { hour: number; minute: number } {
  const span = 24 * 60;
  const total = (((hour * 60 + minute + deltaMinutes) % span) + span) % span;
  return { hour: Math.floor(total / 60), minute: total % 60 };
}

export function toggleReminderDay(days: readonly Weekday[], day: Weekday): Weekday[] {
  const selected = new Set(days);
  if (selected.has(day)) selected.delete(day);
  else selected.add(day);
  return WEEKDAYS.filter((item) => selected.has(item));
}

export function formatReminderClock(hour: number, minute: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2020, 0, 1, hour, minute)));
}

export function reminderDaySummary(days: readonly Weekday[], t: ReminderTranslate): string {
  if (days.length === WEEKDAYS.length) return t("reminders.everyDay");
  return days.map((day) => t(`reminders.dayShort.${DAY_KEYS[day]}`)).join(" ");
}

export function reminderHref(projectId: string | null, openSprint = false): string {
  if (projectId && openSprint) return `/project/${projectId}/sprint`;
  return projectId ? `/project/${projectId}/chapters` : "/manuscripts";
}

export function reminderNotificationText(
  reminder: Pick<WritingReminder, "projectId" | "wordGoal">,
  projectTitle: string | null | undefined,
  t: ReminderTranslate
): { title: string; body: string } {
  if (reminder.projectId == null) {
    return {
      title: t("reminders.notify.generalTitle"),
      body: t("reminders.notify.generalBody", { count: reminder.wordGoal }),
    };
  }
  const title = projectTitle?.trim()
    ? projectTitle.trim()
    : t("reminders.notify.missingTitle");
  return {
    title: t("reminders.notify.manuscriptTitle", { title }),
    body: t("reminders.notify.manuscriptBody", { count: reminder.wordGoal, title }),
  };
}

export function planReminderNotifications(
  reminders: readonly WritingReminder[],
  titles: Readonly<Record<string, string>>,
  t: ReminderTranslate
): PlannedReminderNotification[] {
  const planned: PlannedReminderNotification[] = [];
  for (const reminder of reminders) {
    if (!reminder.enabled) continue;
    const text = reminderNotificationText(
      reminder,
      reminder.projectId ? titles[reminder.projectId] : null,
      t
    );
    const data = {
      kind: "writing-reminder" as const,
      reminderId: reminder.id,
      projectId: reminder.projectId,
      href: reminderHref(reminder.projectId, reminder.openSprint),
    };
    if (reminder.days.length === WEEKDAYS.length) {
      planned.push({
        identifier: `${REMINDER_NOTIFICATION_PREFIX}${reminder.id}.daily`,
        ...text,
        trigger: { kind: "daily", hour: reminder.hour, minute: reminder.minute },
        data,
      });
      continue;
    }
    for (const weekday of reminder.days) {
      planned.push({
        identifier: `${REMINDER_NOTIFICATION_PREFIX}${reminder.id}.w${weekday}`,
        ...text,
        trigger: { kind: "weekly", weekday, hour: reminder.hour, minute: reminder.minute },
        data,
      });
    }
  }
  return planned;
}

/** Expo weekly triggers number Sunday as 1 and Saturday as 7. */
export function expoWeekday(weekday: Weekday): number {
  return weekday + 1;
}

export function reminderHrefFromNotificationData(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const src = data as Record<string, unknown>;
  if (src.kind !== "writing-reminder") return null;
  if (typeof src.href !== "string" || !src.href.startsWith("/") || src.href.startsWith("//")) {
    return null;
  }
  return src.href;
}
