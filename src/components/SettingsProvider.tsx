"use client";

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
import {
  applyTheme,
  getStoredTheme,
  THEME_STORAGE_KEY,
} from "@/lib/theme";
import {
  applyPatch,
  clampChatWidth,
  defaultSettings,
  normalizeSettings,
  SETTINGS_EPOCH,
  SETTINGS_STORAGE_KEY,
  SETTINGS_SYNC_EVENT,
  SETTINGS_USER_KEY,
  settingsEqual,
  type AppSettings,
  type SettingsPatch,
} from "@/lib/settings";

type SettingsState = {
  settings: AppSettings;
  patch: (partial: SettingsPatch) => void;
  refresh: () => Promise<void>;
};

const SettingsContext = createContext<SettingsState | null>(null);

function readLegacyLocal(): SettingsPatch {
  const patch: SettingsPatch = {};
  const theme = getStoredTheme();
  if (theme) patch.theme = theme;
  try {
    const raw = localStorage.getItem("ciciro-chat-width");
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n)) patch.chatWidth = clampChatWidth(n);
  } catch {
    /* ignore */
  }
  return patch;
}

function readLocalSettings(): AppSettings {
  const defaults = defaultSettings();
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) return normalizeSettings(JSON.parse(raw));
  } catch {
    /* ignore */
  }
  const legacy = readLegacyLocal();
  const hasLegacy = Object.keys(legacy).length > 0;
  return {
    ...defaults,
    ...legacy,
    updatedAt: hasLegacy ? defaults.updatedAt : SETTINGS_EPOCH,
  };
}

function readLocalUserId(): string | null {
  try {
    return localStorage.getItem(SETTINGS_USER_KEY);
  } catch {
    return null;
  }
}

function writeLocalSettings(settings: AppSettings, userId?: string | null) {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    localStorage.setItem(THEME_STORAGE_KEY, settings.theme);
    localStorage.setItem("ciciro-chat-width", String(settings.chatWidth));
    if (userId) localStorage.setItem(SETTINGS_USER_KEY, userId);
  } catch {
    /* ignore */
  }
}

export function applyClientSettings(settings: AppSettings) {
  applyTheme(settings.theme);
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-editor-font", settings.editorFont);
  document.documentElement.setAttribute("spellcheck", settings.autoCorrect ? "true" : "false");
  document.documentElement.setAttribute("data-reduce-motion", settings.reduceMotion ? "true" : "false");
  document.documentElement.style.setProperty("--editor-size", `${settings.editorFontSize}px`);
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(() => defaultSettings());
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commit = useCallback((next: AppSettings, sync: "patch" | "put" | "none", userId?: string | null) => {
    settingsRef.current = next;
    setSettings(next);
    writeLocalSettings(next, userId);
    applyClientSettings(next);
    if (sync === "none") return;
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => {
      const body = next;
      const method = sync === "put" ? "PUT" : "PATCH";
      const payload =
        method === "PUT"
          ? body
          : {
              theme: body.theme,
              editorFont: body.editorFont,
              editorFontSize: body.editorFontSize,
              formatChrome: body.formatChrome,
              autoCorrect: body.autoCorrect,
              reduceMotion: body.reduceMotion,
              chatWidth: body.chatWidth,
              dailyWordGoal: body.dailyWordGoal,
              weeklyDayTarget: body.weeklyDayTarget,
              showDailyGoal: body.showDailyGoal,
              typewriterMode: body.typewriterMode,
              aiSuggestions: body.aiSuggestions,
            };
      void fetch("/api/settings", {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => {
        /* offline / anonymous */
      });
    }, 350);
  }, []);

  const refresh = useCallback(async () => {
    const local = readLocalSettings();
    applyClientSettings(local);
    settingsRef.current = local;
    setSettings(local);
    writeLocalSettings(local);

    try {
      const res = await fetch("/api/auth/me");
      const data = (await res.json().catch(() => ({}))) as {
        user?: { id: string } | null;
        settings?: AppSettings | null;
      };
      if (!data.user || !data.settings) return;
      const remote = normalizeSettings(data.settings);
      const localMs = Date.parse(local.updatedAt) || 0;
      const remoteMs = Date.parse(remote.updatedAt) || 0;
      const localUserId = readLocalUserId();
      const owned = localUserId === data.user.id;
      const unscoped = !localUserId;
      if (!owned && !unscoped) {
        commit(remote, "none", data.user.id);
        return;
      }
      if (remoteMs > localMs) {
        commit(remote, "none", data.user.id);
        return;
      }
      if (
        localMs > remoteMs &&
        !settingsEqual(local, remote) &&
        local.updatedAt !== SETTINGS_EPOCH
      ) {
        commit(local, "put", data.user.id);
        return;
      }
      commit(local, "none", data.user.id);
    } catch {
      /* stay on local */
    }
  }, [commit]);

  useEffect(() => {
    void refresh();
    function onSession() {
      void refresh();
    }
    window.addEventListener(SETTINGS_SYNC_EVENT, onSession);
    return () => window.removeEventListener(SETTINGS_SYNC_EVENT, onSession);
  }, [refresh]);

  const patch = useCallback(
    (partial: SettingsPatch) => {
      commit(applyPatch(settingsRef.current, partial), "patch");
    },
    [commit]
  );

  const value = useMemo(() => ({ settings, patch, refresh }), [settings, patch, refresh]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsState {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}

