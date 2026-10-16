import { createContext, useContext } from "react";
import type { SettingsPatch } from "./app-settings";
import type { ThemeId } from "./theme";

/**
 * A theme the whole app wears without being the saved setting: the onboarding
 * "Pick a look" step shows it before there is an account to save it to. It is
 * in memory only, so nothing is cached or synced - `adoptPreview` is how a
 * brand-new account keeps it, and `setPreview(null)` how anyone else drops it.
 */
export type ThemePreviewState = {
  preview: ThemeId | null;
  setPreview: (theme: ThemeId | null) => void;
  /** Saves the previewed theme to the account that just signed up, once its settings have loaded. */
  adoptPreview: () => void;
  /**
   * Gives the account that just signed up these settings (e.g. analytics on,
   * where that is the default), once its settings have loaded - so a stale
   * cache or the settings fetch still in flight cannot undo them. Only for a
   * brand-new account: an existing one's saved choices are its own. Only
   * `userId` ever receives them, so a late call cannot land on another account.
   */
  adoptNewAccount: (patch: SettingsPatch, userId: string) => void;
};

const NO_PREVIEW: ThemePreviewState = {
  preview: null,
  setPreview: () => {},
  adoptPreview: () => {},
  adoptNewAccount: () => {},
};

/** Leaf module so Metro/inline-requires cannot split provider and consumer. */
export const ThemePreviewContext = createContext<ThemePreviewState>(NO_PREVIEW);

export function useThemePreview(): ThemePreviewState {
  return useContext(ThemePreviewContext);
}
