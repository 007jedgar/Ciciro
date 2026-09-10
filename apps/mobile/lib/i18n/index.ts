import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import * as Localization from "expo-localization";
import en from "./locales/en";
import es from "./locales/es";
import hi from "./locales/hi";
import zh from "./locales/zh";

export const SUPPORTED_LOCALES = ["en", "es", "hi", "zh"] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_OPTIONS: { id: AppLocale; nativeName: string }[] = [
  { id: "en", nativeName: "English" },
  { id: "es", nativeName: "Español" },
  { id: "hi", nativeName: "हिन्दी" },
  { id: "zh", nativeName: "中文" },
];

const LOCALE_PREF_KEY = "locale";

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

function readStoredLocale(): AppLocale | null {
  try {
    const { getPrefs } = require("../prefs") as typeof import("../prefs");
    const stored = getPrefs().getString(LOCALE_PREF_KEY);
    return isAppLocale(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function resolveDeviceLocale(): AppLocale {
  try {
    const tag = Localization.getLocales()[0];
    const code = tag?.languageCode?.toLowerCase();
    if (code === "zh") return "zh";
    if (isAppLocale(code)) return code;
    const languageTag = tag?.languageTag?.toLowerCase() ?? "";
    if (languageTag.startsWith("zh")) return "zh";
    const prefix = languageTag.split("-")[0];
    if (isAppLocale(prefix)) return prefix;
  } catch {
    /* tests / missing native module */
  }
  return "en";
}

export function getInitialLocale(): AppLocale {
  return readStoredLocale() ?? resolveDeviceLocale();
}

export function persistLocale(locale: AppLocale): void {
  try {
    const { getPrefs } = require("../prefs") as typeof import("../prefs");
    getPrefs().set(LOCALE_PREF_KEY, locale);
  } catch {
    /* web / tests / missing native module */
  }
}

export async function setAppLocale(locale: AppLocale): Promise<void> {
  persistLocale(locale);
  await i18n.changeLanguage(locale);
}

export function currentLocale(): AppLocale {
  const resolved = i18n.resolvedLanguage ?? i18n.language;
  const prefix = resolved.split("-")[0];
  return isAppLocale(prefix) ? prefix : "en";
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    es: { translation: es },
    hi: { translation: hi },
    zh: { translation: zh },
  },
  lng: getInitialLocale(),
  fallbackLng: "en",
  supportedLngs: [...SUPPORTED_LOCALES],
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

export function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function asStringMatrix(value: unknown): string[][] {
  if (!Array.isArray(value)) return [];
  return value.map(asStringList).filter((row) => row.length > 0);
}

export default i18n;
