import { useSyncExternalStore } from "react";
import type { SelectionActionId } from "./selection-menu";
import type { Synonyms } from "./use-synonyms";

/**
 * The strip over highlighted text lives in the project header, not by the
 * selection: the system callout (Cut, Copy, the block styles) hangs wherever
 * UIKit puts it, over the page, so anything placed near the selection can end
 * up under it. The screen publishes what the strip shows here and the tabs
 * layout, which owns the header, draws it (see `SelectionDockHost`).
 */
export type SelectionDockModel = {
  target: "word" | "passage";
  /** The word the synonyms are for (the passage itself when `target` is a passage). */
  word: string;
  synonyms: Synonyms;
  onAction: (action: SelectionActionId) => void;
  onSynonym: (synonym: string, fromMore: boolean) => void;
};

/** A pick beyond this many synonyms is reported as coming from "more" (the first few sit in view, the rest are a scroll away). */
export const SYNONYMS_SHOWN = 3;

/**
 * The header's accessory is the Focus / Listen pills over the writing meter.
 * Where both show, the strip covers them with its own two rows (the actions
 * over the synonyms); the meter row is `DOCK_SYNONYMS_ROW` tall, the pills row
 * `DOCK_ACTIONS_ROW` with its bottom gap. Where only one row can be covered
 * (focus mode, or a writer who turned the daily goal off) the strip is one
 * row of `DOCK_ROW_HEIGHT` holding both.
 */
export const DOCK_ACTIONS_ROW = 43;
export const DOCK_SYNONYMS_ROW = 36;
export const DOCK_ROW_HEIGHT = 46;

export type DockFrame = {
  top: number;
  height: number;
  /** Two rows (actions over synonyms) rather than one row holding both. */
  stacked: boolean;
};

/**
 * Where the strip sits. It hangs from the header's measured bottom edge, so
 * the page under the header never moves; in focus mode, with the header away,
 * it sits just under the status bar. `synonymsRow` is whether there is a row
 * of synonyms (a word whose lookup is running or done): without one the strip
 * covers only the pills' row and leaves the meter showing.
 */
export function dockFrame({
  headerHeight,
  safeTop,
  focused,
  meterShown,
  synonymsRow,
}: {
  headerHeight: number;
  safeTop: number;
  focused: boolean;
  meterShown: boolean;
  synonymsRow: boolean;
}): DockFrame {
  if (focused) return { top: safeTop, height: DOCK_ROW_HEIGHT, stacked: false };
  if (!meterShown) return { top: Math.max(0, headerHeight - DOCK_ROW_HEIGHT), height: DOCK_ROW_HEIGHT, stacked: false };
  const full = DOCK_ACTIONS_ROW + DOCK_SYNONYMS_ROW;
  return {
    top: Math.max(0, headerHeight - full),
    height: synonymsRow ? full : DOCK_ACTIONS_ROW,
    stacked: true,
  };
}

/** Whether the model has a row of synonyms to show: a word whose lookup is running or has answered. */
export function hasSynonymsRow(model: Pick<SelectionDockModel, "target" | "synonyms">): boolean {
  return model.target === "word" && (model.synonyms.status === "loading" || model.synonyms.status === "ready");
}

let model: SelectionDockModel | null = null;
const listeners = new Set<() => void>();

export function getSelectionDock(): SelectionDockModel | null {
  return model;
}

export function setSelectionDock(next: SelectionDockModel | null) {
  if (model === next) return;
  model = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSelectionDock(): SelectionDockModel | null {
  return useSyncExternalStore(subscribe, getSelectionDock, getSelectionDock);
}
