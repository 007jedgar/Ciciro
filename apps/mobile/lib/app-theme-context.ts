import { createContext, useContext } from "react";
import type { AppSettings, SettingsPatch } from "./app-settings";
import type { ColorTokens } from "./theme";
import { makeLayout } from "./theme";

export type AppThemeState = {
  settings: AppSettings;
  colors: ColorTokens;
  layout: ReturnType<typeof makeLayout>;
  dark: boolean;
  patch: (partial: SettingsPatch) => void;
};

/** Leaf module so Metro/inline-requires cannot split provider and consumer. */
export const AppThemeContext = createContext<AppThemeState | null>(null);

export function useAppTheme(): AppThemeState {
  const ctx = useContext(AppThemeContext);
  if (!ctx) throw new Error("useAppTheme must be used within SettingsProvider");
  return ctx;
}

export function useOptionalAppTheme(): AppThemeState | null {
  return useContext(AppThemeContext);
}
