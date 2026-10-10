import { SHORTCUT_ORDER, shortcutDigit, type ScreenplayElement } from "@/lib/screenplay";

/**
 * How an element's shortcut reads: "Alt+Shift+3", or "⌥⇧3" on a Mac. With
 * "aria" it is the form `aria-keyshortcuts` takes ("Alt+Shift+3").
 */
export function elementShortcutLabel(element: ScreenplayElement, mac: boolean, style: "text" | "aria" = "text"): string {
  const digit = shortcutDigit(element);
  return mac && style === "text" ? `⌥⇧${digit}` : `Alt+Shift+${digit}`;
}

export type ShortcutRow = { keys: string; label: string };

/** Every shortcut a script has, for the settings reference: the keys that move between elements, then one per element. */
export function screenplayShortcuts(mac: boolean, labels: Record<ScreenplayElement, string>): ShortcutRow[] {
  return [
    { keys: "Tab", label: "Next element" },
    { keys: "Shift+Tab", label: "Previous element" },
    { keys: "Enter", label: "New line, in the element that follows" },
    ...SHORTCUT_ORDER.map((element) => ({
      keys: elementShortcutLabel(element, mac),
      label: labels[element],
    })),
  ];
}
