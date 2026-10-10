"use client";

import type { SuggestInfo } from "@/lib/tiptap-screenplay";

const KIND_LABELS = { name: "Character", place: "Location", time: "Time of day", prefix: "Scene heading" } as const;

/** Air between the caret's line and the list, and the least the list keeps from the shell's left edge. */
const GAP = 6;

/**
 * The names, places and times of day a cue or a scene heading may take, under
 * the caret. Keys stay in the page (Tab takes the first, the arrows move,
 * Escape closes), so the list is only shown and clicked: a press must not take
 * the caret out of the page.
 */
export default function ScriptSuggest({
  info,
  shell,
  onPick,
}: {
  info: SuggestInfo;
  shell: HTMLElement | null;
  onPick: (index: number) => void;
}) {
  const box = shell?.getBoundingClientRect();
  const left = box ? Math.max(0, info.coords.left - box.left) : 0;
  const top = box ? info.coords.bottom - box.top + GAP : 0;
  const kind = info.items[0]?.kind ?? "name";
  return (
    <div className="script-suggest" style={{ left, top }} data-testid="script-suggest">
      <div className="script-suggest-kind" aria-hidden="true">
        {KIND_LABELS[kind]}
      </div>
      <ul role="listbox" aria-label={KIND_LABELS[kind]}>
        {info.items.map((item, i) => (
          <li
            key={item.label}
            role="option"
            aria-selected={i === info.selected}
            className={i === info.selected ? "is-selected" : undefined}
            // Keep the caret in the page while picking.
            onMouseDown={(event) => {
              event.preventDefault();
              onPick(i);
            }}
          >
            {item.label}
          </li>
        ))}
      </ul>
      <div className="script-suggest-hint" aria-hidden="true">
        Tab to take · ↑↓ to choose
      </div>
      <div className="selection-menu-live" role="status" aria-live="polite">
        {`${info.items.length} ${info.items.length === 1 ? "suggestion" : "suggestions"}. ${info.items[info.selected]?.label ?? ""}. Press Tab to take it.`}
      </div>
    </div>
  );
}
