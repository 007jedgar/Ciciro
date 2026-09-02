/** Starting knobs from docs/gamification.md. Not retail pricing. */

export const SIGNUP_CREDIT_GRANT = 200;
export const SIGNUP_GRANT_REASON = "earn_grant";

export const DEFAULT_DAILY_PROSE = 500;
export const DEFAULT_WEEKLY_PROSE = 2500;
export const DEFAULT_MONTHLY_PROSE = 10000;
export const DEFAULT_DAILY_CHAIR_MINUTES = 25;
export const DEFAULT_TIMEZONE = "UTC";

export const HUMAN_WPM_CAP = 80;
export const PASTE_WORD_THRESHOLD = 40;
/** Small typing is allowed before a heartbeat posts chair time. */
export const MIN_CHAIR_MINUTES_FOR_CAP = 1;
export const HUMAN_RATIO_FULL = 0.7;
export const HUMAN_RATIO_MIXED = 0.4;

export const CREDIT_RETURN = 2;
export const CREDIT_PROSE_FULL = 15;
export const CREDIT_PROSE_MIXED = 5;
export const CREDIT_CHAIR = 1;
export const DAILY_EARN_CAP = 25;

export const RETURN_CHAIR_MINUTES = 5;
export const MAX_HEARTBEAT_CHAIR_SECONDS = 180;
export const MAX_DAILY_CHAIR_SECONDS = 16 * 3600;

export const GRACE_WINDOW_DAYS = 30;
export const MAX_EARNED_FREEZES = 3;
export const FREEZE_EVERY_CLOSED_DAYS = 7;

export const AI_SOURCE_WINDOW_MS = 120_000;

export const REASON_RETURN = "earn_return";
export const REASON_PROSE_FULL = "earn_prose_full";
export const REASON_PROSE_MIXED = "earn_prose_mixed";
export const REASON_CHAIR = "earn_chair";

export const STREAK_KIND_RETURN = "return";

export const CADENCES = ["daily", "weekdays", "every_n", "custom"] as const;
export type ReminderCadence = (typeof CADENCES)[number];

export const SAVE_SOURCES = [
  "human",
  "autowrite",
  "draft_insert",
  "editor_mutate",
  "chat",
] as const;
export type SaveSource = (typeof SAVE_SOURCES)[number];
