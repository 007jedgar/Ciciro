import { Platform } from "react-native";
import { useSyncExternalStore } from "react";
import {
  ELEMENT_METRICS,
  PAGE_COLUMNS,
  SCREENPLAY_ELEMENTS,
  SPEECH_RUNS,
  nextElementOnEnter,
} from "./screenplay";

// Writing a script in its page layout, in the native editor (the patched
// react-native-enriched-html: see AGENTS.md, "Patched native editor", and
// docs/screenplay.md, "Writing in the page layout"). iOS only, and Beta: it is a
// switch in the script's Settings section, off until the author turns it on.

/** This build of the native editor can lay a script out while it is typed: iOS only so far. */
export function scriptLayoutSupported(): boolean {
  return Platform.OS === "ios";
}

/** The switch belongs to this device (it needs the native build), so it lives in local prefs. */
const LAYOUT_KEY = "script-layout";

let layoutOn: boolean | null = null;
const listeners = new Set<() => void>();

function readStored(): boolean {
  try {
    const { getPrefs } = require("./prefs") as typeof import("./prefs");
    return getPrefs().getString(LAYOUT_KEY) === "true";
  } catch {
    return false;
  }
}

function writeStored(on: boolean) {
  try {
    const { getPrefs } = require("./prefs") as typeof import("./prefs");
    getPrefs().set(LAYOUT_KEY, on ? "true" : "false");
  } catch {
    /* web / tests / missing native module */
  }
}

/** Whether the author turned the page layout on. Always false where the editor cannot do it. */
export function getScriptLayout(): boolean {
  if (!scriptLayoutSupported()) return false;
  if (layoutOn === null) layoutOn = readStored();
  return layoutOn;
}

export function setScriptLayout(on: boolean) {
  if (getScriptLayout() === on) return;
  layoutOn = on;
  writeStored(on);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useScriptLayout(): boolean {
  return useSyncExternalStore(subscribe, getScriptLayout, getScriptLayout);
}

/**
 * The page the native editor lays a script out on, as the JSON its `screenplay`
 * prop takes. Every number comes from the shared engine (`ELEMENT_METRICS`,
 * `nextElementOnEnter`, `SPEECH_RUNS`), so the editor holds no page rules of its
 * own and cannot disagree with the page view, the web editor or the PDF.
 */
export function screenplayLayoutConfig(): string {
  const elements: Record<string, { indent: number; width: number; align: string; caps: boolean }> = {};
  const enter: Record<string, string> = {};
  for (const element of SCREENPLAY_ELEMENTS) {
    const { indent, width, align, caps } = ELEMENT_METRICS[element];
    elements[element] = { indent, width, align, caps };
    enter[element] = nextElementOnEnter(element);
  }
  return JSON.stringify({ columns: PAGE_COLUMNS, elements, enter, runs: SPEECH_RUNS });
}

/** JetBrains Mono, like Courier, is 0.6 em wide, so the 60 column page is 36 em. */
const ADVANCE = 0.6;

/** A line of a script is a little taller than its type (the page view's ratio), and a blank line is one line. */
const LINE_RATIO = 1.25;

/**
 * Type for the editor at `width`: the largest size, to a quarter point, at which
 * the 60 columns of the page fit the width the editor has, so every line breaks
 * where the page breaks it. A hair is held back so rounding never wraps a full
 * line early.
 */
export function scriptEditorMetrics(width: number): { fontSize: number; lineHeight: number } {
  const fontSize = Math.max(4, Math.floor(((width - 0.5) / (PAGE_COLUMNS * ADVANCE)) * 4) / 4);
  return { fontSize, lineHeight: Math.round(fontSize * LINE_RATIO * 4) / 4 };
}
