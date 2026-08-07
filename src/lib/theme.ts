export type ThemeId =
  | "parchment"
  | "sage"
  | "ember"
  | "walnut"
  | "inkwell"
  | "candle";

export type ThemeMeta = {
  id: ThemeId;
  label: string;
  mode: "light" | "dark";
  /** Swatch colors for the picker: [bg, accent] */
  swatch: [string, string];
};

export const THEMES: ThemeMeta[] = [
  { id: "parchment", label: "Parchment", mode: "light", swatch: ["#f2ebe0", "#b4552d"] },
  { id: "sage", label: "Sage", mode: "light", swatch: ["#e8ebe3", "#6b7a4e"] },
  { id: "ember", label: "Ember", mode: "dark", swatch: ["#1a1713", "#d9754a"] },
  { id: "walnut", label: "Walnut", mode: "dark", swatch: ["#1c1410", "#c4a574"] },
  { id: "inkwell", label: "Inkwell", mode: "dark", swatch: ["#121820", "#c9a27a"] },
  { id: "candle", label: "Candle", mode: "dark", swatch: ["#14110e", "#e0a85c"] },
];

export const THEME_STORAGE_KEY = "ciciro-theme";
export const DEFAULT_LIGHT: ThemeId = "parchment";
export const DEFAULT_DARK: ThemeId = "ember";

export function isThemeId(value: string | null | undefined): value is ThemeId {
  return THEMES.some((t) => t.id === value);
}

export function resolveTheme(stored: string | null): ThemeId {
  if (isThemeId(stored)) return stored;
  if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return DEFAULT_DARK;
  }
  return DEFAULT_LIGHT;
}

export function applyTheme(id: ThemeId) {
  document.documentElement.setAttribute("data-theme", id);
  document.documentElement.style.colorScheme = THEMES.find((t) => t.id === id)?.mode ?? "light";
}

export function getStoredTheme(): ThemeId | null {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeId(v) ? v : null;
  } catch {
    return null;
  }
}

export function setStoredTheme(id: ThemeId) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
  applyTheme(id);
}
