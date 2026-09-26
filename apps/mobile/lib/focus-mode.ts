import type { AppSettings } from "./app-settings";

/** Share of the editor's height kept clear above and below the text in typewriter mode. */
export const TYPEWRITER_INSET_RATIO = 0.4;

/** Chrome (header, tab bar, meters) hides only while writing on the editor tab. */
export function focusChromeHidden(settings: Pick<AppSettings, "focusMode">, onEditor: boolean): boolean {
  return settings.focusMode && onEditor;
}

/**
 * Typewriter mode pads the page so the line being written can rest near the
 * middle of the screen instead of sinking to the bottom edge.
 */
export function typewriterInsets(
  typewriterMode: boolean,
  viewportHeight: number
): { top: number; bottom: number } {
  if (!typewriterMode || !Number.isFinite(viewportHeight) || viewportHeight <= 0) {
    return { top: 0, bottom: 0 };
  }
  const inset = Math.round(viewportHeight * TYPEWRITER_INSET_RATIO);
  return { top: inset, bottom: inset };
}
