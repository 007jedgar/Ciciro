import { SHORTCUT_ORDER, shortcutDigit, type ScreenplayElement } from "@/lib/screenplay";

/**
 * How an element's shortcut reads: "Alt+Shift+3", or "⌥⇧3" on a Mac. With
 * "aria" it is the form `aria-keyshortcuts` takes ("Alt+Shift+3").
 */
export function elementShortcutLabel(element: ScreenplayElement, mac: boolean, style: "text" | "aria" = "text"): string {
  const digit = shortcutDigit(element);
  return mac && style === "text" ? `⌥⇧${digit}` : `Alt+Shift+${digit}`;
}

/** Why a script control is grayed out for a script in another language. */
export const SCRIPT_LANGUAGE_NOTE =
  "Script formatting is only available in English and Spanish for now. We plan to support more languages.";

export type ShortcutRow = { keys: string; label: string };

/** Every shortcut a script has, for the settings reference: the keys that move between elements, then one per element. */
export function screenplayShortcuts(mac: boolean, labels: Record<ScreenplayElement, string>): ShortcutRow[] {
  return [
    { keys: "Tab", label: "Take the first suggestion, or move on" },
    { keys: "Shift+Tab", label: "Previous element" },
    { keys: "Enter", label: "New line, in the element that follows" },
    { keys: "↑ ↓", label: "Choose a suggestion" },
    { keys: "Esc", label: "Close the suggestions" },
    ...SHORTCUT_ORDER.map((element) => ({
      keys: elementShortcutLabel(element, mac),
      label: labels[element],
    })),
    { keys: mac ? "⌥⇧D" : "Alt+Shift+D", label: "Dual dialogue: beside the speech above" },
  ];
}

/** How writing a script goes faster, for the settings reference: each tip is one short paragraph. */
export const WRITING_SPEED_TIPS: readonly string[] = [
  "Names, places and times of day are suggested as you type, from this script and the characters in the story bible. Tab takes the first one, the arrow keys choose, Esc closes the list.",
  "After INT. or EXT., Tab moves to the location, then to the time of day, then on to the next element. Tab on a cue starts a parenthetical.",
  "Scene headings, cues, transitions and shots are typed in capitals. Text that is already there is left as written, and the page sets it in capitals anyway.",
  "The V.O., O.S. and CONT'D buttons switch an extension on the cue. A cue for a character who picks up a speech after some action gets CONT'D when you press Enter.",
];
