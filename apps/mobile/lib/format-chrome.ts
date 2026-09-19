import type { FormatChrome } from "./app-settings";

export const FORMAT_IDLE_MS = 900;
export const FORMAT_BAR_HEIGHT = 52;

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

export function showSelectionBubble(chrome: FormatChrome, selected: boolean): boolean {
  if (!selected) return false;
  return chrome === "smart" || chrome === "selection";
}

export function showPressMenu(chrome: FormatChrome): boolean {
  return chrome === "smart" || chrome === "press";
}
