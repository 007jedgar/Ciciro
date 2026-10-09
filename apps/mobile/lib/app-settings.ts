import { DEFAULT_THEME, isThemeId, type ThemeId } from "./theme";
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
  typewriterMode: boolean;
  /** Ciciro's line edits arrive as tracked suggestions to accept or reject. */
  aiSuggestions: boolean;
  /** "Experimental writing prompt": craft defaults and a post-draft check for prose Ciciro drafts. Opt-in. */
  craftDefaults: boolean;
  /** Product analytics (PostHog). Opt-out; see docs/analytics.md. */
  analyticsEnabled: boolean;
  updatedAt: string;
};

export type SettingsPatch = Partial<Omit<AppSettings, "updatedAt">>;

export function defaultSettings(): AppSettings {
  return {
    theme: DEFAULT_THEME,
    editorFont: "serif",
    editorFontSize: 19,
    formatChrome: DEFAULT_FORMAT_CHROME,
    autoCorrect: true,
    reduceMotion: false,
    chatWidth: 380,
    dailyWordGoal: DEFAULT_DAILY_WORD_GOAL,
    weeklyDayTarget: DEFAULT_WEEKLY_DAY_TARGET,
    showDailyGoal: true,
    typewriterMode: false,
    aiSuggestions: true,
    craftDefaults: false,
    analyticsEnabled: true,
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
    typewriterMode:
      typeof src.typewriterMode === "boolean" ? src.typewriterMode : defaults.typewriterMode,
    aiSuggestions: typeof src.aiSuggestions === "boolean" ? src.aiSuggestions : defaults.aiSuggestions,
    craftDefaults: typeof src.craftDefaults === "boolean" ? src.craftDefaults : defaults.craftDefaults,
    analyticsEnabled:
      typeof src.analyticsEnabled === "boolean" ? src.analyticsEnabled : defaults.analyticsEnabled,
    updatedAt:
      typeof src.updatedAt === "string" && Number.isFinite(Date.parse(src.updatedAt))
        ? new Date(src.updatedAt).toISOString()
        : defaults.updatedAt,
  };
}

/**
 * The daily word goal in force, or 0 for none. A goal is optional: with
 * `showDailyGoal` off the stored `dailyWordGoal` is only the number the next
 * goal starts from, so anything goal-dependent (the meter, the widget, a
 * reminder skipped on a met day) reads this, never `dailyWordGoal` directly.
 */
export function activeDailyGoal(settings: Pick<AppSettings, "showDailyGoal" | "dailyWordGoal">): number {
  return settings.showDailyGoal ? settings.dailyWordGoal : 0;
}

export function applyPatch(current: AppSettings, patch: SettingsPatch): AppSettings {
  return { ...current, ...patch, updatedAt: new Date().toISOString() };
}

/**
 * Whether these settings were ever saved: true once the author changed one,
 * false while they are still nobody's pick (the server's blank account, or a
 * phone that never synced or changed anything), null when that is not known
 * (a cache from before the phone kept track, or a server that does not say).
 */
export type SettingsSaved = boolean | null;

/**
 * Settings nobody saved hold someone else's default theme (the server hands
 * back the web's "parchment"), not a pick, so the phone shows its own default
 * instead. Saved or unknown settings are returned as stored.
 */
export function withPhoneDefaultTheme(settings: AppSettings, saved: SettingsSaved): AppSettings {
  return saved === false && settings.theme !== DEFAULT_THEME ? { ...settings, theme: DEFAULT_THEME } : settings;
}

/** What the phone knows of a cached copy: a copy still at the epoch was never changed or synced. */
export function cachedSettingsSaved(settings: AppSettings, stored: SettingsSaved): SettingsSaved {
  if (stored !== null) return stored;
  return settings.updatedAt === SETTINGS_EPOCH ? false : null;
}

export type SettingsReconcile = {
  settings: AppSettings;
  saved: SettingsSaved;
  /** "put" when the phone's copy is the newer change and the server should take it. */
  sync: "put" | "none";
};

/**
 * Picks between the phone's cached copy and the server's on sign-in or launch.
 * `owned` is false when the cache belongs to another account. `remoteSaved` is
 * undefined from a server that predates the flag, which never moves a theme.
 */
export function reconcileSettings(input: {
  local: AppSettings;
  localSaved: SettingsSaved;
  owned: boolean;
  remote: AppSettings;
  remoteSaved: boolean | undefined;
}): SettingsReconcile {
  const { local, localSaved, owned } = input;
  const remoteSaved = input.remoteSaved ?? null;
  const remote = withPhoneDefaultTheme(input.remote, remoteSaved);
  const fromRemote: SettingsReconcile = { settings: remote, saved: remoteSaved, sync: "none" };
  if (!owned) return fromRemote;
  const localMs = Date.parse(local.updatedAt) || 0;
  const remoteMs = Date.parse(remote.updatedAt) || 0;
  if (remoteMs > localMs) return fromRemote;
  if (localMs > remoteMs && !settingsEqual(local, remote) && local.updatedAt !== SETTINGS_EPOCH) {
    return { settings: local, saved: true, sync: "put" };
  }
  if (remoteSaved === false && localSaved !== true) {
    return { settings: withPhoneDefaultTheme(local, false), saved: false, sync: "none" };
  }
  return { settings: local, saved: localSaved ?? remoteSaved, sync: "none" };
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
    a.typewriterMode === b.typewriterMode &&
    a.aiSuggestions === b.aiSuggestions &&
    a.craftDefaults === b.craftDefaults &&
    a.analyticsEnabled === b.analyticsEnabled
  );
}
