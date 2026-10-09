import type { OnSelectionFrameEvent } from "react-native-enriched-html";

/**
 * Where the native editor says the selection sits: its first and last line, in
 * the editor's own points with the scroll offset already applied. Missing (the
 * editor sends nothing) on a build whose native view predates the event.
 */
export type SelectionFrame = {
  topX: number;
  topY: number;
  topWidth: number;
  topHeight: number;
  bottomX: number;
  bottomY: number;
  bottomWidth: number;
  bottomHeight: number;
};

export function frameFromEvent(event: OnSelectionFrameEvent): SelectionFrame {
  return {
    topX: event.topX,
    topY: event.topY,
    topWidth: event.topWidth,
    topHeight: event.topHeight,
    bottomX: event.bottomX,
    bottomY: event.bottomY,
    bottomWidth: event.bottomWidth,
    bottomHeight: event.bottomHeight,
  };
}

export type MenuPlacement = { left: number; top: number; below: boolean };

/**
 * The menu goes under the selection, where the system callout (Cut, Copy,
 * Paste) does not: that one opens above. With no room below it goes above,
 * and with no room at either end it sits as low as the page allows. It is
 * centred on the line it hangs from and kept inside the page.
 *
 * A worklet: the menu follows the selection as the page scrolls, on the UI
 * thread, so the numbers it needs are plain arguments and its spacing is
 * written inline: 8 points to the page's edge, 12 above the selection (the
 * system handle hangs off the first line's start) and 20 below it (off the
 * last line's end).
 */
export function placeSelectionMenu(
  frame: SelectionFrame,
  menuWidth: number,
  menuHeight: number,
  boundsWidth: number,
  boundsHeight: number,
): MenuPlacement {
  "worklet";
  const edge = 8;
  const belowTop = frame.bottomY + frame.bottomHeight + 20;
  const aboveTop = frame.topY - menuHeight - 12;
  const fitsBelow = belowTop + menuHeight <= boundsHeight - edge;
  const fitsAbove = aboveTop >= edge;
  const below = fitsBelow || !fitsAbove;
  const rawTop = below ? belowTop : aboveTop;
  const top = Math.max(edge, Math.min(rawTop, boundsHeight - menuHeight - edge));
  const center = below
    ? frame.bottomX + frame.bottomWidth / 2
    : frame.topX + frame.topWidth / 2;
  const left = Math.max(edge, Math.min(center - menuWidth / 2, boundsWidth - menuWidth - edge));
  return { left, top, below };
}

/**
 * Whether any of the selection is on show; a frame scrolled out of the page
 * needs no menu. A worklet, read from the menu's animated style.
 */
export function frameVisible(frame: SelectionFrame, boundsHeight: number): boolean {
  "worklet";
  const bottom = frame.bottomY + frame.bottomHeight;
  return bottom > 0 && frame.topY < boundsHeight;
}

/** How many synonyms fit on the first line of chips; the rest wait behind "N more...". */
export const SYNONYMS_SHOWN = 3;
