import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Appearance } from "react-native";
import { api } from "./api";
import {
  applyPatch,
  defaultSettings,
  normalizeSettings,
  SETTINGS_EPOCH,
  settingsEqual,
  type AppSettings,
  type SettingsPatch,
} from "./app-settings";
import { useSession } from "./session";
import {
  isDarkTheme,
  makeLayout,
  THEME_PALETTES,
  type ColorTokens,
} from "./theme";

const CACHE_KEY = "settings";
const CACHE_USER_KEY = "settings-user-id";

function readCache(): AppSettings {
  try {
    const { getPrefs } = require("./prefs") as typeof import("./prefs");
    const raw = getPrefs().getString(CACHE_KEY);
    if (raw) return normalizeSettings(JSON.parse(raw));
  } catch {
    /* web / tests / missing native module */
  }
  return defaultSettings();
}

function readCacheUserId(): string | null {
  try {
    const { getPrefs } = require("./prefs") as typeof import("./prefs");
    return getPrefs().getString(CACHE_USER_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeCache(settings: AppSettings, userId?: string | null) {
  try {
    const { getPrefs } = require("./prefs") as typeof import("./prefs");
    const prefs = getPrefs();
    prefs.set(CACHE_KEY, JSON.stringify(settings));
    if (userId) prefs.set(CACHE_USER_KEY, userId);
  } catch {
    /* ignore */
  }
}

type AppThemeState = {
  settings: AppSettings;
  colors: ColorTokens;
  layout: ReturnType<typeof makeLayout>;
  dark: boolean;
  patch: (partial: SettingsPatch) => void;
};

const AppThemeContext = createContext<AppThemeState | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commit = useCallback(
    (next: AppSettings, sync: "patch" | "put" | "none", userId?: string | null) => {
      settingsRef.current = next;
      setSettings(next);
      writeCache(next, userId);
      Appearance.setColorScheme?.(isDarkTheme(next.theme) ? "dark" : "light");
      if (sync === "none" || !user) return;
      if (pushTimer.current) clearTimeout(pushTimer.current);
      pushTimer.current = setTimeout(() => {
        const method = sync === "put" ? "PUT" : "PATCH";
        const payload =
          method === "PUT"
            ? next
            : {
                theme: next.theme,
                editorFont: next.editorFont,
                editorFontSize: next.editorFontSize,
                autoCorrect: next.autoCorrect,
                chatWidth: next.chatWidth,
              };
        void api("/api/settings", {
          method,
          body: JSON.stringify(payload),
        }).catch(() => {});
      }, 350);
    },
    [user]
  );

  useEffect(() => {
    const local = readCache();
    commit(local, "none");
    if (!user) return;
    let cancelled = false;
    void (async () => {
      try {
        const data = await api<{ settings: AppSettings }>("/api/settings");
        if (cancelled) return;
        const remote = normalizeSettings(data.settings);
        const localMs = Date.parse(local.updatedAt) || 0;
        const remoteMs = Date.parse(remote.updatedAt) || 0;
        const localUserId = readCacheUserId();
        const owned = localUserId === user.id;
        const unscoped = !localUserId;
        if (!owned && !unscoped) {
          commit(remote, "none", user.id);
          return;
        }
        if (remoteMs > localMs) {
          commit(remote, "none", user.id);
          return;
        }
        if (
          localMs > remoteMs &&
          !settingsEqual(local, remote) &&
          local.updatedAt !== SETTINGS_EPOCH
        ) {
          commit(local, "put", user.id);
          return;
        }
        commit(local, "none", user.id);
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
      commit(applyPatch(settingsRef.current, partial), "patch", user?.id);
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

export function useAppTheme(): AppThemeState {
  const ctx = useContext(AppThemeContext);
  if (!ctx) throw new Error("useAppTheme must be used within SettingsProvider");
  return ctx;
}

export function useOptionalAppTheme(): AppThemeState | null {
  return useContext(AppThemeContext);
}
