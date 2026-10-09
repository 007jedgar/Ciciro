import { splitWord, type SplitWord } from "./selection-menu";

// The desk's side of the menu over highlighted text: where it sits, how the
// keyboard moves through it and which characters a synonym replaces. Pure so
// it can be tested without a browser; the shared rules live in selection-menu.ts.

/** The gap between the selection and the menu, and the margin the menu keeps from the page's edges. */
export const MENU_GAP = 8;
export const MENU_EDGE = 8;

/** How many synonyms show before the rest go behind "N more...". */
export const SYNONYMS_SHOWN = 3;

export type Placement = "above" | "below";

export type MenuPlacementInput = {
  /** Top of the selection's first line and bottom of its last, relative to the editor shell. */
  startTop: number;
  endBottom: number;
  /** The x the menu centers on, relative to the shell. */
  centerX: number;
  menu: { width: number; height: number };
  /** The room the menu may use sideways, relative to the shell: the editor pane, not just the page. */
  minLeft: number;
  maxRight: number;
  /** The top of the visible page, below which the menu may sit above the selection. */
  minTop: number;
};

/** Above the selection when it fits on the page, else below it; always inside the room it has sideways. */
export function placeMenu(input: MenuPlacementInput): { top: number; left: number; placement: Placement } {
  const { menu } = input;
  const roomAbove = input.startTop - menu.height - MENU_GAP;
  const placement: Placement = roomAbove >= input.minTop ? "above" : "below";
  const top = placement === "above" ? roomAbove : input.endBottom + MENU_GAP;
  const min = input.minLeft;
  const max = input.maxRight - menu.width;
  const wanted = input.centerX - menu.width / 2;
  const left = max < min ? min : Math.min(Math.max(wanted, min), max);
  return { top, left, placement };
}

/** Where the menu centers over a selection: halfway between its two ends. */
export function anchorCenter(startLeft: number, endLeft: number): number {
  return (startLeft + endLeft) / 2;
}

export type WordRange = SplitWord & { from: number; to: number };

/**
 * The document range of the word inside a one-word selection that starts at
 * `from`, leaving any quote mark, space or full stop that came with it alone.
 * The selection has to sit in one paragraph, where a character is a position.
 */
export function wordRange(from: number, text: string): WordRange | null {
  const split = splitWord(text);
  if (!split) return null;
  const start = from + split.lead.length;
  return { ...split, from: start, to: start + split.word.length };
}

type KeyLike = { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean };

/** Command-K (Control-K elsewhere): move into the menu while text is selected. */
export function isMenuShortcut(event: KeyLike): boolean {
  return (
    event.key.toLowerCase() === "k" &&
    (event.metaKey || event.ctrlKey) &&
    !(event.metaKey && event.ctrlKey) &&
    !event.shiftKey &&
    !event.altKey
  );
}

export function shortcutLabel(mac: boolean): string {
  return mac ? "⌘K" : "Ctrl+K";
}

/** What a screen reader hears once when the menu appears. */
export function menuAnnouncement(mac: boolean): string {
  return `Selection actions available. Press ${mac ? "Command K" : "Control K"} to open.`;
}

export function isMacPlatform(platform: string | undefined): boolean {
  return /Mac|iPhone|iPad/i.test(platform ?? "");
}

/** The roving-focus move for an arrow, Home or End key, or null when the key is not one. */
export function nextIndex(current: number, count: number, key: string): number | null {
  if (count <= 0) return null;
  if (key === "ArrowRight" || key === "ArrowDown") return (current + 1) % count;
  if (key === "ArrowLeft" || key === "ArrowUp") return (current - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

/** The synonyms shown as chips and how many wait behind "N more...". */
export function splitSynonyms(list: string[], shown = SYNONYMS_SHOWN): { shown: string[]; rest: string[] } {
  return { shown: list.slice(0, shown), rest: list.slice(shown) };
}
