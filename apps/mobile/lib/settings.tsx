import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Appearance } from "react-native";
import { ciciro } from "./api/resources";
import {
  applyPatch,
  cachedSettingsSaved,
  defaultSettings,
  normalizeSettings,
  reconcileSettings,
  withPhoneDefaultTheme,
  type AppSettings,
  type SettingsPatch,
  type SettingsSaved,
} from "./app-settings";
import { AppThemeContext, type AppThemeState } from "./app-theme-context";
import { useSession } from "./session";
import { isDarkTheme, makeLayout, THEME_PALETTES } from "./theme";

export { useAppTheme, useOptionalAppTheme } from "./app-theme-context";
export type { AppThemeState };

const CACHE_KEY = "settings";
const CACHE_USER_KEY = "settings-user-id";
const CACHE_SAVED_KEY = "settings-saved";

type CachedSettings = { settings: AppSettings; saved: SettingsSaved };

function readCache(): CachedSettings {
  try {
    const { getPrefs } = require("./prefs") as typeof import("./prefs");
    const prefs = getPrefs();
    const raw = prefs.getString(CACHE_KEY);
    if (raw) {
      const settings = normalizeSettings(JSON.parse(raw));
      const flag = prefs.getString(CACHE_SAVED_KEY);
      const saved = cachedSettingsSaved(settings, flag === "1" ? true : flag === "0" ? false : null);
      return { settings: withPhoneDefaultTheme(settings, saved), saved };
    }
  } catch {
    /* web / tests / missing native module */
  }
  return { settings: defaultSettings(), saved: false };
}

function readCacheUserId(): string | null {
  try {
    const { getPrefs } = require("./prefs") as typeof import("./prefs");
    return getPrefs().getString(CACHE_USER_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeCache(settings: AppSettings, saved: SettingsSaved, userId?: string | null) {
  try {
    const { getPrefs } = require("./prefs") as typeof import("./prefs");
    const prefs = getPrefs();
    prefs.set(CACHE_KEY, JSON.stringify(settings));
    if (saved === null) prefs.remove(CACHE_SAVED_KEY);
    else prefs.set(CACHE_SAVED_KEY, saved ? "1" : "0");
    if (userId) prefs.set(CACHE_USER_KEY, userId);
  } catch {
    /* ignore */
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commit = useCallback(
    (next: AppSettings, saved: SettingsSaved, sync: "patch" | "put" | "none", userId?: string | null) => {
      settingsRef.current = next;
      setSettings(next);
      writeCache(next, saved, userId);
      Appearance.setColorScheme?.(isDarkTheme(next.theme) ? "dark" : "light");
      if (sync === "none" || !user) return;
      if (pushTimer.current) clearTimeout(pushTimer.current);
      pushTimer.current = setTimeout(() => {
        const syncRequest =
          sync === "put"
            ? ciciro.settings.put(next)
            : ciciro.settings.patch({
                theme: next.theme,
                editorFont: next.editorFont,
                editorFontSize: next.editorFontSize,
                formatChrome: next.formatChrome,
                autoCorrect: next.autoCorrect,
                reduceMotion: next.reduceMotion,
                chatWidth: next.chatWidth,
                dailyWordGoal: next.dailyWordGoal,
                weeklyDayTarget: next.weeklyDayTarget,
                showDailyGoal: next.showDailyGoal,
                typewriterMode: next.typewriterMode,
                aiSuggestions: next.aiSuggestions,
                craftDefaults: next.craftDefaults,
                analyticsEnabled: next.analyticsEnabled,
              });
        void syncRequest.catch(() => {});
      }, 350);
    },
    [user]
  );

  useEffect(() => {
    const local = readCache();
    commit(local.settings, local.saved, "none");
    if (!user) return;
    let cancelled = false;
    void (async () => {
      try {
        const data = await ciciro.settings.get();
        if (cancelled) return;
        const localUserId = readCacheUserId();
        const next = reconcileSettings({
          local: local.settings,
          localSaved: local.saved,
          owned: !localUserId || localUserId === user.id,
          remote: normalizeSettings(data.settings),
          remoteSaved: typeof data.settingsSaved === "boolean" ? data.settingsSaved : undefined,
        });
        commit(next.settings, next.saved, next.sync, user.id);
      } catch {
        /* stay local */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, commit]);

  const patch = useCallback(
    (partial: SettingsPatch) => {
      commit(applyPatch(settingsRef.current, partial), true, "patch", user?.id);
    },
    [commit, user?.id]
  );

  const colors = THEME_PALETTES[settings.theme];
  const layout = useMemo(
    () => makeLayout(colors, settings.editorFont),
    [colors, settings.editorFont]
  );
  const value = useMemo(
    () => ({
      settings,
      colors,
      layout,
      dark: isDarkTheme(settings.theme),
      patch,
    }),
    [settings, colors, layout, patch]
  );

  return <AppThemeContext.Provider value={value}>{children}</AppThemeContext.Provider>;
}
