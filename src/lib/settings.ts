import { isThemeId, type ThemeId } from "@/lib/theme";
import {
  clampDailyWordGoal,
  clampWeeklyDayTarget,
  DEFAULT_DAILY_WORD_GOAL,
  DEFAULT_WEEKLY_DAY_TARGET,
} from "@/lib/writing-day";

export const SETTINGS_STORAGE_KEY = "ciciro-settings";
export const SETTINGS_USER_KEY = "ciciro-settings-user";
export const SETTINGS_SYNC_EVENT = "ciciro-session";

export const EDITOR_FONT_SIZES = [15, 17, 19, 21, 23] as const;
export type EditorFontSize = (typeof EDITOR_FONT_SIZES)[number];
export type EditorFont = "serif" | "sans";
export const FORMAT_CHROME = ["smart", "selection", "press", "always"] as const;
export type FormatChrome = (typeof FORMAT_CHROME)[number];
export const DEFAULT_FORMAT_CHROME: FormatChrome = "smart";

export function isFormatChrome(value: unknown): value is FormatChrome {
  return typeof value === "string" && (FORMAT_CHROME as readonly string[]).includes(value);
}

export const CHAT_WIDTH_MIN = 280;
export const CHAT_WIDTH_MAX = 720;
export const DEFAULT_CHAT_WIDTH = 380;
export const DEFAULT_EDITOR_FONT_SIZE: EditorFontSize = 19;

export type AppSettings = {
  theme: ThemeId;
  editorFont: EditorFont;
  editorFontSize: EditorFontSize;
  formatChrome: FormatChrome;
  autoCorrect: boolean;
  reduceMotion: boolean;
  chatWidth: number;
  dailyWordGoal: number;
  weeklyDayTarget: number;
  showDailyGoal: boolean;
  focusMode: boolean;
  typewriterMode: boolean;
  updatedAt: string;
};

export type SettingsPatch = Partial<Omit<AppSettings, "updatedAt">>;

const EPOCH = "1970-01-01T00:00:00.000Z";

export function defaultSettings(now = new Date()): AppSettings {
  return {
    theme: "parchment",
    editorFont: "serif",
    editorFontSize: DEFAULT_EDITOR_FONT_SIZE,
    formatChrome: DEFAULT_FORMAT_CHROME,
    autoCorrect: true,
    reduceMotion: false,
    chatWidth: DEFAULT_CHAT_WIDTH,
    dailyWordGoal: DEFAULT_DAILY_WORD_GOAL,
    weeklyDayTarget: DEFAULT_WEEKLY_DAY_TARGET,
    showDailyGoal: true,
    focusMode: false,
    typewriterMode: false,
    updatedAt: now.toISOString(),
  };
}

export function clampChatWidth(n: number): number {
  return Math.min(CHAT_WIDTH_MAX, Math.max(CHAT_WIDTH_MIN, Math.round(n)));
}

export function nearestFontSize(n: number): EditorFontSize {
  let best: EditorFontSize = DEFAULT_EDITOR_FONT_SIZE;
  let bestDist = Infinity;
  for (const size of EDITOR_FONT_SIZES) {
    const dist = Math.abs(size - n);
    if (dist < bestDist) {
      best = size;
      bestDist = dist;
    }
  }
  return best;
}

function asIso(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return fallback;
  return new Date(ms).toISOString();
}

function timestamp(value: string): number {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function asDate(value: unknown): Date {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed;
  }
  return new Date();
}

/** Normalize unknown JSON into a full AppSettings object. */
export function normalizeSettings(raw: unknown, now: Date | string = new Date()): AppSettings {
  const at = asDate(now);
  const src =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const defaults = defaultSettings(at);
  const theme = typeof src.theme === "string" && isThemeId(src.theme) ? src.theme : defaults.theme;
  const editorFont = src.editorFont === "sans" || src.editorFont === "serif" ? src.editorFont : defaults.editorFont;
  const editorFontSize =
    typeof src.editorFontSize === "number" && Number.isFinite(src.editorFontSize)
      ? nearestFontSize(src.editorFontSize)
      : defaults.editorFontSize;
  const formatChrome = isFormatChrome(src.formatChrome) ? src.formatChrome : defaults.formatChrome;
  const autoCorrect = typeof src.autoCorrect === "boolean" ? src.autoCorrect : defaults.autoCorrect;
  const reduceMotion = typeof src.reduceMotion === "boolean" ? src.reduceMotion : defaults.reduceMotion;
  const chatWidth =
    typeof src.chatWidth === "number" && Number.isFinite(src.chatWidth)
      ? clampChatWidth(src.chatWidth)
      : defaults.chatWidth;
  const dailyWordGoal =
    typeof src.dailyWordGoal === "number" && Number.isFinite(src.dailyWordGoal)
      ? clampDailyWordGoal(src.dailyWordGoal)
      : defaults.dailyWordGoal;
  const weeklyDayTarget =
    typeof src.weeklyDayTarget === "number" && Number.isFinite(src.weeklyDayTarget)
      ? clampWeeklyDayTarget(src.weeklyDayTarget)
      : defaults.weeklyDayTarget;
  const showDailyGoal = typeof src.showDailyGoal === "boolean" ? src.showDailyGoal : defaults.showDailyGoal;
  const focusMode = typeof src.focusMode === "boolean" ? src.focusMode : defaults.focusMode;
  const typewriterMode =
    typeof src.typewriterMode === "boolean" ? src.typewriterMode : defaults.typewriterMode;
  return {
    theme,
    editorFont,
    editorFontSize,
    formatChrome,
    autoCorrect,
    reduceMotion,
    chatWidth,
    dailyWordGoal,
    weeklyDayTarget,
    showDailyGoal,
    focusMode,
    typewriterMode,
    updatedAt: asIso(src.updatedAt, defaults.updatedAt),
  };
}

export function parseSettingsJson(json: string, fallbackUpdatedAt?: Date | string): AppSettings {
  let raw: unknown = {};
  try {
    raw = json ? JSON.parse(json) : {};
  } catch {
    raw = {};
  }
  const now = asDate(fallbackUpdatedAt);
  const normalized = normalizeSettings(raw, now);
  if (!json || json === "{}") {
    return { ...normalized, updatedAt: now.toISOString() };
  }
  return normalized;
}

export function parseSettingsPatch(body: unknown): SettingsPatch | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Expected a settings object." };
  }
  const src = body as Record<string, unknown>;
  const patch: SettingsPatch = {};

  if ("theme" in src) {
    if (typeof src.theme !== "string" || !isThemeId(src.theme)) {
      return { error: "Unknown theme." };
    }
    patch.theme = src.theme;
  }
  if ("editorFont" in src) {
    if (src.editorFont !== "serif" && src.editorFont !== "sans") {
      return { error: "editorFont must be serif or sans." };
    }
    patch.editorFont = src.editorFont;
  }
  if ("editorFontSize" in src) {
    if (typeof src.editorFontSize !== "number" || !Number.isFinite(src.editorFontSize)) {
      return { error: "editorFontSize must be a number." };
    }
    patch.editorFontSize = nearestFontSize(src.editorFontSize);
  }
  if ("formatChrome" in src) {
    if (!isFormatChrome(src.formatChrome)) {
      return { error: "formatChrome must be smart, selection, press, or always." };
    }
    patch.formatChrome = src.formatChrome;
  }
  if ("autoCorrect" in src) {
    if (typeof src.autoCorrect !== "boolean") {
      return { error: "autoCorrect must be a boolean." };
    }
    patch.autoCorrect = src.autoCorrect;
  }
  if ("reduceMotion" in src) {
    if (typeof src.reduceMotion !== "boolean") {
      return { error: "reduceMotion must be a boolean." };
    }
    patch.reduceMotion = src.reduceMotion;
  }
  if ("chatWidth" in src) {
    if (typeof src.chatWidth !== "number" || !Number.isFinite(src.chatWidth)) {
      return { error: "chatWidth must be a number." };
    }
    patch.chatWidth = clampChatWidth(src.chatWidth);
  }
  if ("dailyWordGoal" in src) {
    if (typeof src.dailyWordGoal !== "number" || !Number.isFinite(src.dailyWordGoal)) {
      return { error: "dailyWordGoal must be a number." };
    }
    patch.dailyWordGoal = clampDailyWordGoal(src.dailyWordGoal);
  }
  if ("weeklyDayTarget" in src) {
    if (typeof src.weeklyDayTarget !== "number" || !Number.isFinite(src.weeklyDayTarget)) {
      return { error: "weeklyDayTarget must be a number." };
    }
    patch.weeklyDayTarget = clampWeeklyDayTarget(src.weeklyDayTarget);
  }
  if ("showDailyGoal" in src) {
    if (typeof src.showDailyGoal !== "boolean") {
      return { error: "showDailyGoal must be a boolean." };
    }
    patch.showDailyGoal = src.showDailyGoal;
  }
  if ("focusMode" in src) {
    if (typeof src.focusMode !== "boolean") {
      return { error: "focusMode must be a boolean." };
    }
    patch.focusMode = src.focusMode;
  }
  if ("typewriterMode" in src) {
    if (typeof src.typewriterMode !== "boolean") {
      return { error: "typewriterMode must be a boolean." };
    }
    patch.typewriterMode = src.typewriterMode;
  }

  return patch;
}

export function applyPatch(current: AppSettings, patch: SettingsPatch, now = new Date()): AppSettings {
  return {
    ...current,
    ...patch,
    updatedAt: now.toISOString(),
  };
}

/** Prefer the document with the later updatedAt. Equal timestamps keep `preferred`. */
export function pickNewer(preferred: AppSettings, other: AppSettings): AppSettings {
  return timestamp(other.updatedAt) > timestamp(preferred.updatedAt) ? other : preferred;
}

export function settingsEqual(a: AppSettings, b: AppSettings): boolean {
  return (
    a.theme === b.theme &&
    a.editorFont === b.editorFont &&
    a.editorFontSize === b.editorFontSize &&
    a.formatChrome === b.formatChrome &&
    a.autoCorrect === b.autoCorrect &&
    a.reduceMotion === b.reduceMotion &&
    a.chatWidth === b.chatWidth &&
    a.dailyWordGoal === b.dailyWordGoal &&
    a.weeklyDayTarget === b.weeklyDayTarget &&
    a.showDailyGoal === b.showDailyGoal &&
    a.focusMode === b.focusMode &&
    a.typewriterMode === b.typewriterMode
  );
}

export { EPOCH as SETTINGS_EPOCH };
