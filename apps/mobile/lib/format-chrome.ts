import type { FormatChrome } from "./app-settings";

export const FORMAT_IDLE_MS = 900;
export const FORMAT_BAR_HEIGHT = 52;
export const FORMAT_PRESS_MS = 420;

/** Fade and lift the overlay. Never change layout height — that shoves the page. */
export function headerBarOverlay(progress: number): { opacity: number; translateY: number } {
  const amount = Math.max(0, Math.min(1, progress));
  return { opacity: 1 - amount, translateY: -12 * amount || 0 };
}

export function formatBarPlacement(chrome: FormatChrome): "header" | "accessory" | "none" {
  if (chrome === "always") return "accessory";
  if (chrome === "smart") return "header";
  return "none";
}

export function hideFormatBarWhileTyping(chrome: FormatChrome, typing: boolean): boolean {
  return chrome === "smart" && typing;
}

/**
 * The B / I / U / S bubble over a highlight is the "On highlight" home's only
 * formatting control. The Smart header and Always on already carry the same
 * four buttons in a bar, so there the bubble would only sit over the page
 * next to the system callout.
 */
export function showSelectionBubble(chrome: FormatChrome, selected: boolean): boolean {
  return selected && chrome === "selection";
}

export function showPressMenu(chrome: FormatChrome): boolean {
  return chrome === "smart" || chrome === "press";
}

/** Overlay chips only. Never insert them into the chapter flow — that shoves the page. */
export function overlayFormatChrome({
  chrome,
  selected,
  pressOpen,
  grammarOpen,
}: {
  chrome: FormatChrome;
  selected: boolean;
  pressOpen: boolean;
  grammarOpen: boolean;
}): { bubble: boolean; press: boolean } {
  return {
    bubble: !grammarOpen && showSelectionBubble(chrome, selected),
    press: showPressMenu(chrome) && pressOpen,
  };
}
