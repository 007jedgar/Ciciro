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
import { ThemePreviewContext } from "./theme-preview-context";
import { useSession } from "./session";
import { isDarkTheme, makeLayout, THEME_PALETTES, type ThemeId } from "./theme";

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
  // The onboarding theme preview (lib/theme-preview-context.ts): worn by the
  // whole app, never cached or synced, kept by a new account via `adoptPreview`.
  const [preview, setPreviewState] = useState<ThemeId | null>(null);
  const previewRef = useRef<ThemeId | null>(null);
  const userRef = useRef(user);
  userRef.current = user;
  const adoptPending = useRef(false);
  const reconciledFor = useRef<string | null>(null);

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

  // Gives the account that just signed up the theme it previewed, on top of the
  // settings it loaded (so a stale device cache cannot win over the pick).
  const adopt = useCallback(
    (userId: string) => {
      adoptPending.current = false;
      const theme = previewRef.current;
      if (theme) commit(applyPatch(settingsRef.current, { theme }), true, "patch", userId);
      previewRef.current = null;
      setPreviewState(null);
    },
    [commit]
  );

  useEffect(() => {
    const local = readCache();
    commit(local.settings, local.saved, "none");
    reconciledFor.current = null;
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
      if (cancelled) return;
      reconciledFor.current = user.id;
      if (adoptPending.current) adopt(user.id);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, commit, adopt]);

  const patch = useCallback(
    (partial: SettingsPatch) => {
      commit(applyPatch(settingsRef.current, partial), true, "patch", user?.id);
    },
    [commit, user?.id]
  );

  const setPreview = useCallback((theme: ThemeId | null) => {
    previewRef.current = theme;
    if (theme === null) adoptPending.current = false;
    setPreviewState(theme);
    // The status bar and system chrome follow what is on screen, saved or not.
    Appearance.setColorScheme?.(isDarkTheme(theme ?? settingsRef.current.theme) ? "dark" : "light");
  }, []);

  const adoptPreview = useCallback(() => {
    const current = userRef.current;
    if (current && reconciledFor.current === current.id) adopt(current.id);
    else adoptPending.current = true;
  }, [adopt]);

  const previewValue = useMemo(
    () => ({ preview, setPreview, adoptPreview }),
    [preview, setPreview, adoptPreview]
  );

  const shownTheme = preview ?? settings.theme;
  const colors = THEME_PALETTES[shownTheme];
  const layout = useMemo(
    () => makeLayout(colors, settings.editorFont),
    [colors, settings.editorFont]
  );
  const value = useMemo(
    () => ({
      settings,
      colors,
      layout,
      dark: isDarkTheme(shownTheme),
      patch,
    }),
    [settings, colors, layout, patch, shownTheme]
  );

  return (
    <ThemePreviewContext.Provider value={previewValue}>
      <AppThemeContext.Provider value={value}>{children}</AppThemeContext.Provider>
    </ThemePreviewContext.Provider>
  );
}
