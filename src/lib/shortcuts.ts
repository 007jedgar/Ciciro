/**
 * The web editor's general (non-screenplay-element) keyboard shortcuts: a
 * pure list for the shortcuts reference and the guard that keeps them from
 * firing while a writer types somewhere unrelated (the chat box, a dialog's
 * field). The screenplay element shortcuts live in `screenplay-view.ts`
 * (`screenplayShortcuts`); this is everything else a writer meets across
 * every manuscript kind.
 */

export type ShortcutRow = { keys: string; label: string };

/** "Cmd" on a Mac, "Ctrl" everywhere else - the modifier every row below is built on. */
function mod(mac: boolean): string {
  return mac ? "⌘" : "Ctrl+";
}

/**
 * The shortcuts every manuscript kind has, in the order they are introduced
 * in the UI (search, focus, undo/redo, bold/italic, then navigation and
 * help). `hasChapters` is false for a library view with nothing open.
 */
export function generalShortcuts(mac: boolean, hasChapters: boolean): ShortcutRow[] {
  const cmd = mod(mac);
  return [
    { keys: `${cmd}Z`, label: "Undo" },
    { keys: mac ? "⌘⇧Z" : "Ctrl+Shift+Z", label: "Redo" },
    { keys: `${cmd}B`, label: "Bold" },
    { keys: `${cmd}I`, label: "Italic" },
    { keys: mac ? "⌘⇧F" : "Ctrl+Shift+F", label: "Find and replace" },
    { keys: mac ? "⌘⇧Enter" : "Ctrl+Shift+Enter", label: "Focus mode" },
    { keys: mac ? "⌘⌥T" : "Ctrl+Alt+T", label: "Typewriter mode" },
    ...(hasChapters
      ? [
          { keys: mac ? "⌥⇧↓" : "Alt+Shift+↓", label: "Next chapter" },
          { keys: mac ? "⌥⇧↑" : "Alt+Shift+↑", label: "Previous chapter" },
        ]
      : []),
    { keys: mac ? "⌘/" : "Ctrl+/", label: "Keyboard shortcuts" },
  ];
}

/**
 * True when `target` is an editing surface a global shortcut should leave
 * alone: a plain input or textarea (the chat box, a dialog's field, a title
 * box), or any contenteditable that is not the manuscript editor itself. The
 * manuscript editor (ProseMirror's root) is excluded so its own shortcuts -
 * bold, undo, the screenplay element picks - keep working while it has focus.
 */
export function isUnrelatedInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  const editable = target.closest('[contenteditable=""], [contenteditable="true"]');
  return editable !== null && !editable.closest(".ProseMirror");
}
