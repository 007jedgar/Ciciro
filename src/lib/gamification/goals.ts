import {
  CADENCES,
  DEFAULT_DAILY_CHAIR_MINUTES,
  DEFAULT_DAILY_PROSE,
  DEFAULT_MONTHLY_PROSE,
  DEFAULT_WEEKLY_PROSE,
  type ReminderCadence,
} from "./constants";
import { isValidHhMm, isValidLocalDate, isValidTimeZone, localWeekday, daysBetween } from "./time";

export type GoalsPatch = {
  dailyProseTarget?: number;
  weeklyProseTarget?: number;
  monthlyProseTarget?: number;
  dailyChairMinutes?: number;
  sessionMinutesTarget?: number | null;
  reminderCadence?: ReminderCadence;
  reminderEveryNDays?: number | null;
  reminderWeekdays?: number[];
  reminderHour?: number;
  reminderMinute?: number;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  timezone?: string;
  deadlineProjectId?: string | null;
  deadlineLocalDate?: string | null;
  deadlineWordTarget?: number | null;
  pauseUntil?: string | null;
};

export type GoalsView = {
  dailyProseTarget: number;
  weeklyProseTarget: number;
  monthlyProseTarget: number;
  dailyChairMinutes: number;
  sessionMinutesTarget: number | null;
  reminderCadence: ReminderCadence;
  reminderEveryNDays: number | null;
  reminderWeekdays: number[];
  reminderHour: number;
  reminderMinute: number;
  quietHoursStart: string;
  quietHoursEnd: string;
  timezone: string;
  deadlineProjectId: string | null;
  deadlineLocalDate: string | null;
  deadlineWordTarget: number | null;
  pauseUntil: string | null;
};

export const DEFAULT_GOALS: Omit<GoalsView, "timezone"> = {
  dailyProseTarget: DEFAULT_DAILY_PROSE,
  weeklyProseTarget: DEFAULT_WEEKLY_PROSE,
  monthlyProseTarget: DEFAULT_MONTHLY_PROSE,
  dailyChairMinutes: DEFAULT_DAILY_CHAIR_MINUTES,
  sessionMinutesTarget: null,
  reminderCadence: "daily",
  reminderEveryNDays: null,
  reminderWeekdays: [],
  reminderHour: 9,
  reminderMinute: 0,
  quietHoursStart: "22:00",
  quietHoursEnd: "08:00",
  deadlineProjectId: null,
  deadlineLocalDate: null,
  deadlineWordTarget: null,
  pauseUntil: null,
};

export type GoalsParseError = { error: string };

function intInRange(
  value: unknown,
  min: number,
  max: number,
  label: string
): number | GoalsParseError {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return { error: `${label} must be a whole number.` };
  }
  if (value < min || value > max) {
    return { error: `${label} must be between ${min} and ${max}.` };
  }
  return value;
}

function isError(value: unknown): value is GoalsParseError {
  return typeof value === "object" && value !== null && "error" in value;
}

export function parseGoalsPatch(body: unknown): GoalsPatch | GoalsParseError {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Send a JSON object of goal fields." };
  }
  const raw = body as Record<string, unknown>;
  const patch: GoalsPatch = {};

  const intFields: Array<[keyof GoalsPatch, number, number, string]> = [
    ["dailyProseTarget", 1, 100_000, "Daily prose target"],
    ["weeklyProseTarget", 1, 500_000, "Weekly prose target"],
    ["monthlyProseTarget", 1, 2_000_000, "Monthly prose target"],
    ["dailyChairMinutes", 1, 24 * 60, "Daily chair minutes"],
    ["reminderHour", 0, 23, "Reminder hour"],
    ["reminderMinute", 0, 59, "Reminder minute"],
  ];

  for (const [key, min, max, label] of intFields) {
    if (!(key in raw)) continue;
    const parsed = intInRange(raw[key], min, max, label);
    if (isError(parsed)) return parsed;
    (patch as Record<string, unknown>)[key] = parsed;
  }

  if ("sessionMinutesTarget" in raw) {
    if (raw.sessionMinutesTarget === null) {
      patch.sessionMinutesTarget = null;
    } else {
      const parsed = intInRange(
        raw.sessionMinutesTarget,
        1,
        8 * 60,
        "Session minutes"
      );
      if (isError(parsed)) return parsed;
      patch.sessionMinutesTarget = parsed;
    }
  }

  if ("reminderCadence" in raw) {
    if (typeof raw.reminderCadence !== "string" || !CADENCES.includes(raw.reminderCadence as ReminderCadence)) {
      return { error: "Reminder cadence must be daily, weekdays, every_n, or custom." };
    }
    patch.reminderCadence = raw.reminderCadence as ReminderCadence;
  }

  if ("reminderEveryNDays" in raw) {
    if (raw.reminderEveryNDays === null) {
      patch.reminderEveryNDays = null;
    } else {
      const parsed = intInRange(raw.reminderEveryNDays, 2, 30, "Every-N-days");
      if (isError(parsed)) return parsed;
      patch.reminderEveryNDays = parsed;
    }
  }

  if ("reminderWeekdays" in raw) {
    if (!Array.isArray(raw.reminderWeekdays)) {
      return { error: "Custom weekdays must be an array of 0-6." };
    }
    const days: number[] = [];
    for (const day of raw.reminderWeekdays) {
      if (typeof day !== "number" || !Number.isInteger(day) || day < 0 || day > 6) {
        return { error: "Custom weekdays must be integers from 0 (Sunday) to 6 (Saturday)." };
      }
      if (!days.includes(day)) days.push(day);
    }
    days.sort((a, b) => a - b);
    patch.reminderWeekdays = days;
  }

  for (const key of ["quietHoursStart", "quietHoursEnd"] as const) {
    if (!(key in raw)) continue;
    if (typeof raw[key] !== "string" || !isValidHhMm(raw[key])) {
      return { error: "Quiet hours must be HH:MM in 24-hour local time." };
    }
    patch[key] = raw[key];
  }

  if ("timezone" in raw) {
    if (typeof raw.timezone !== "string" || !raw.timezone.trim() || !isValidTimeZone(raw.timezone.trim())) {
      return { error: "Timezone must be a valid IANA name." };
    }
    patch.timezone = raw.timezone.trim();
  }

  if ("deadlineProjectId" in raw) {
    if (raw.deadlineProjectId === null) {
      patch.deadlineProjectId = null;
    } else if (typeof raw.deadlineProjectId !== "string" || !raw.deadlineProjectId.trim()) {
      return { error: "Deadline project is not valid." };
    } else {
      patch.deadlineProjectId = raw.deadlineProjectId.trim();
    }
  }

  if ("deadlineLocalDate" in raw) {
    if (raw.deadlineLocalDate === null) {
      patch.deadlineLocalDate = null;
    } else if (
      typeof raw.deadlineLocalDate !== "string" ||
      !isValidLocalDate(raw.deadlineLocalDate)
    ) {
      return { error: "Deadline date must be YYYY-MM-DD." };
    } else {
      patch.deadlineLocalDate = raw.deadlineLocalDate;
    }
  }

  if ("deadlineWordTarget" in raw) {
    if (raw.deadlineWordTarget === null) {
      patch.deadlineWordTarget = null;
    } else {
      const parsed = intInRange(
        raw.deadlineWordTarget,
        1,
        5_000_000,
        "Deadline word target"
      );
      if (isError(parsed)) return parsed;
      patch.deadlineWordTarget = parsed;
    }
  }

  if ("pauseUntil" in raw) {
    if (raw.pauseUntil === null) {
      patch.pauseUntil = null;
    } else if (typeof raw.pauseUntil !== "string" || Number.isNaN(Date.parse(raw.pauseUntil))) {
      return { error: "Pause until must be an ISO date." };
    } else {
      patch.pauseUntil = new Date(raw.pauseUntil).toISOString();
    }
  }

  const cadence = patch.reminderCadence;
  if (cadence === "every_n" && patch.reminderEveryNDays == null && !("reminderEveryNDays" in raw && raw.reminderEveryNDays === null)) {
    // Cadence every_n without N in this same patch is checked against merged prefs later.
  }
  if (cadence === "custom" && patch.reminderWeekdays && patch.reminderWeekdays.length === 0) {
    return { error: "Custom cadence needs at least one weekday." };
  }

  if (Object.keys(patch).length === 0) {
    return { error: "No goal fields to update." };
  }
  return patch;
}

export type SchedulePrefs = {
  reminderCadence: string;
  reminderEveryNDays: number | null;
  reminderWeekdays: number[];
};

/** Whether a local civil date is a scheduled writing day. */
export function isScheduledDate(localDate: string, prefs: SchedulePrefs, timeZone: string): boolean {
  const cadence = prefs.reminderCadence;
  if (cadence === "daily") return true;
  const weekday = localWeekday(localDate, timeZone);
  if (cadence === "weekdays") return weekday >= 1 && weekday <= 5;
  if (cadence === "custom") return prefs.reminderWeekdays.includes(weekday);
  if (cadence === "every_n") {
    const n = prefs.reminderEveryNDays ?? 2;
    return daysBetween("1970-01-01", localDate) % n === 0;
  }
  return true;
}

export function parseWeekdaysJson(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (d): d is number => typeof d === "number" && Number.isInteger(d) && d >= 0 && d <= 6
    );
  } catch {
    return [];
  }
}

export function validateMergedGoals(prefs: GoalsView): GoalsParseError | null {
  if (prefs.reminderCadence === "every_n" && (prefs.reminderEveryNDays == null || prefs.reminderEveryNDays < 2)) {
    return { error: "Every-N-days cadence needs N of 2 or more." };
  }
  if (prefs.reminderCadence === "custom" && prefs.reminderWeekdays.length === 0) {
    return { error: "Custom cadence needs at least one weekday." };
  }
  return null;
}
