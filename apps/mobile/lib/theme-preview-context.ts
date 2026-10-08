import { createContext, useContext } from "react";
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
};

const NO_PREVIEW: ThemePreviewState = { preview: null, setPreview: () => {}, adoptPreview: () => {} };

/** Leaf module so Metro/inline-requires cannot split provider and consumer. */
export const ThemePreviewContext = createContext<ThemePreviewState>(NO_PREVIEW);

export function useThemePreview(): ThemePreviewState {
  return useContext(ThemePreviewContext);
}
