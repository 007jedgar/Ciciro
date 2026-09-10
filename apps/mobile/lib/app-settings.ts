import { isThemeId, type ThemeId } from "./theme";

export const EDITOR_FONT_SIZES = [15, 17, 19, 21, 23] as const;
export type EditorFontSize = (typeof EDITOR_FONT_SIZES)[number];
export type EditorFont = "serif" | "sans";

export const SETTINGS_EPOCH = "1970-01-01T00:00:00.000Z";

export type AppSettings = {
  theme: ThemeId;
  editorFont: EditorFont;
  editorFontSize: EditorFontSize;
  autoCorrect: boolean;
  reduceMotion: boolean;
  chatWidth: number;
  updatedAt: string;
};

export type SettingsPatch = Partial<Omit<AppSettings, "updatedAt">>;

export function defaultSettings(): AppSettings {
  return {
    theme: "parchment",
    editorFont: "serif",
    editorFontSize: 19,
    autoCorrect: true,
    reduceMotion: false,
    chatWidth: 380,
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
    autoCorrect: typeof src.autoCorrect === "boolean" ? src.autoCorrect : defaults.autoCorrect,
    reduceMotion: typeof src.reduceMotion === "boolean" ? src.reduceMotion : defaults.reduceMotion,
    chatWidth:
      typeof src.chatWidth === "number" && Number.isFinite(src.chatWidth)
        ? Math.min(720, Math.max(280, Math.round(src.chatWidth)))
        : defaults.chatWidth,
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
    a.autoCorrect === b.autoCorrect &&
    a.reduceMotion === b.reduceMotion &&
    a.chatWidth === b.chatWidth
  );
}
