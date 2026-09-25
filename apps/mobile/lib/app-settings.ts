import { isThemeId, type ThemeId } from "./theme";
import {
  clampDailyWordGoal,
  clampWeeklyDayTarget,
  DEFAULT_DAILY_WORD_GOAL,
  DEFAULT_WEEKLY_DAY_TARGET,
} from "./writing-day";

export const EDITOR_FONT_SIZES = [15, 17, 19, 21, 23] as const;
export type EditorFontSize = (typeof EDITOR_FONT_SIZES)[number];
export type EditorFont = "serif" | "sans";
export const FORMAT_CHROME = ["smart", "selection", "press", "always"] as const;
export type FormatChrome = (typeof FORMAT_CHROME)[number];
export const DEFAULT_FORMAT_CHROME: FormatChrome = "smart";

export function isFormatChrome(value: unknown): value is FormatChrome {
  return typeof value === "string" && (FORMAT_CHROME as readonly string[]).includes(value);
}

export const SETTINGS_EPOCH = "1970-01-01T00:00:00.000Z";

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
  updatedAt: string;
};

export type SettingsPatch = Partial<Omit<AppSettings, "updatedAt">>;

export function defaultSettings(): AppSettings {
  return {
    theme: "parchment",
    editorFont: "serif",
    editorFontSize: 19,
    formatChrome: DEFAULT_FORMAT_CHROME,
    autoCorrect: true,
    reduceMotion: false,
    chatWidth: 380,
    dailyWordGoal: DEFAULT_DAILY_WORD_GOAL,
    weeklyDayTarget: DEFAULT_WEEKLY_DAY_TARGET,
    showDailyGoal: true,
    updatedAt: SETTINGS_EPOCH,
  };
}

export function nearestFontSize(n: number): EditorFontSize {
  let best: EditorFontSize = 19;
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

export function normalizeSettings(raw: unknown): AppSettings {
  const src =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const defaults = defaultSettings();
  return {
    theme: typeof src.theme === "string" && isThemeId(src.theme) ? src.theme : defaults.theme,
    editorFont: src.editorFont === "sans" || src.editorFont === "serif" ? src.editorFont : defaults.editorFont,
    editorFontSize:
      typeof src.editorFontSize === "number" && Number.isFinite(src.editorFontSize)
        ? nearestFontSize(src.editorFontSize)
        : defaults.editorFontSize,
    formatChrome: isFormatChrome(src.formatChrome) ? src.formatChrome : defaults.formatChrome,
    autoCorrect: typeof src.autoCorrect === "boolean" ? src.autoCorrect : defaults.autoCorrect,
    reduceMotion: typeof src.reduceMotion === "boolean" ? src.reduceMotion : defaults.reduceMotion,
    chatWidth:
      typeof src.chatWidth === "number" && Number.isFinite(src.chatWidth)
        ? Math.min(720, Math.max(280, Math.round(src.chatWidth)))
        : defaults.chatWidth,
    dailyWordGoal:
      typeof src.dailyWordGoal === "number" && Number.isFinite(src.dailyWordGoal)
        ? clampDailyWordGoal(src.dailyWordGoal)
        : defaults.dailyWordGoal,
    weeklyDayTarget:
      typeof src.weeklyDayTarget === "number" && Number.isFinite(src.weeklyDayTarget)
        ? clampWeeklyDayTarget(src.weeklyDayTarget)
        : defaults.weeklyDayTarget,
    showDailyGoal: typeof src.showDailyGoal === "boolean" ? src.showDailyGoal : defaults.showDailyGoal,
    updatedAt:
      typeof src.updatedAt === "string" && Number.isFinite(Date.parse(src.updatedAt))
        ? new Date(src.updatedAt).toISOString()
        : defaults.updatedAt,
  };
}

export function applyPatch(current: AppSettings, patch: SettingsPatch): AppSettings {
  return { ...current, ...patch, updatedAt: new Date().toISOString() };
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
    a.showDailyGoal === b.showDailyGoal
  );
}
