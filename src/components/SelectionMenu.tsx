"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { MOTION_MS, usePresence } from "@/lib/motion";
import type { SelectionActionId, SynonymContext } from "@/lib/selection-menu";
import { nextIndex, placeMenu, splitSynonyms, type Placement } from "@/lib/selection-menu-view";

/** Everything the menu needs to know about the selection it floats over. */
export type SelectionMenuData = {
  /** Changes when the selection does, so per-selection state (synonyms, the open list) starts over. */
  key: string;
  target: "word" | "passage";
  actions: SelectionActionId[];
  /** Top of the selection's first line and bottom of its last, relative to the editor shell. */
  startTop: number;
  endBottom: number;
  centerX: number;
  /** The top of the visible page, relative to the shell. */
  minTop: number;
  /** The room it may use sideways, relative to the shell (the editor pane's edges, less a margin). */
  minLeft: number;
  maxRight: number;
  /** The word and its sentence, when synonyms apply (one real word selected). */
  context: SynonymContext | null;
};

const ACTION_LABELS: Record<SelectionActionId, string> = {
  comment: "Comment",
  rewrite: "Rewrite",
  describe: "Describe",
  expand: "Expand",
  fix: "Fix",
};

const ACTION_HINTS: Record<SelectionActionId, string> = {
  comment: "Ask Ciciro about this text",
  rewrite: "Rewrite this text in fresher words",
  describe: "Add sensory description",
  expand: "Expand this text with more detail",
  fix: "Fix spelling and grammar",
};

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      className="selection-menu-icon"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

const ICONS: Record<SelectionActionId, ReactNode> = {
  comment: (
    <Icon>
      <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" />
    </Icon>
  ),
  rewrite: (
    <Icon>
      <path d="M2.5 13.5 3 10.7l7.2-7.2 2.3 2.3-7.2 7.2z" />
      <path d="M9 4.7l2.3 2.3" />
    </Icon>
  ),
  describe: (
    <Icon>
      <circle cx="7" cy="7" r="3.8" />
      <path d="M9.8 9.8 13.5 13.5" />
    </Icon>
  ),
  expand: (
    <Icon>
      <path d="M2.5 3h11M2.5 13h11" />
      <path d="M8 5.2v5.6M5.8 7.2 8 5l2.2 2.2M5.8 8.8 8 11l2.2-2.2" />
    </Icon>
  ),
  fix: (
    <Icon>
      <path d="M3 8.5 6.2 11.7 13 4.5" />
    </Icon>
  ),
};

type Synonyms = { key: string; list: string[] };

/** A pane narrower than this (px) gets icons without their labels; the buttons keep their names for screen readers. */
const COMPACT_BELOW = 440;

/** What the overflow list needs (the CSS caps it at 240px), with its gap to the menu. */
function listHeight(count: number): number {
  return Math.min(240, count * 32 + 10) + 6;
}

export default function SelectionMenu({
  menu,
  lookup,
  onAction,
  onSynonym,
  onEscape,
  onFocusChange,
  focusRequest,
  shortcut,
}: {
  menu: SelectionMenuData | null;
  lookup: (context: SynonymContext) => Promise<string[]>;
  onAction: (action: SelectionActionId) => void;
  onSynonym: (synonym: string, more: boolean) => void;
  /** Escape inside the menu: the editor takes focus back, selection intact. */
  onEscape: () => void;
  /** Keyboard focus moved into (true) or out of (false) the menu. */
  onFocusChange: (inside: boolean) => void;
  /** Bumped by the shortcut: moves focus to the first button. */
  focusRequest: number;
  /** Shown in the first button's tooltip, e.g. "⌘K". */
  shortcut: string;
}) {
  const { mounted, state } = usePresence(menu !== null, MOTION_MS.popoverOut);
  // While it fades out the menu keeps what it last showed.
  const lastRef = useRef<SelectionMenuData | null>(menu);
  if (menu) lastRef.current = menu;
  const shown = menu ?? lastRef.current;

  const wrapRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; placement: Placement } | null>(null);

  // Synonyms for the word under the menu. A late answer for a word the writer
  // has moved off is dropped by comparing its key, never by aborting the
  // request: the lookup shares it with whoever asks again.
  const context = menu?.context ?? null;
  const contextKey = context ? `${context.before}\u0000${context.word}\u0000${context.after}` : "";
  const [synonyms, setSynonyms] = useState<Synonyms | null>(null);
  useEffect(() => {
    if (!context) return;
    let live = true;
    const key = contextKey;
    lookup(context).then(
      (list) => live && setSynonyms({ key, list }),
      () => live && setSynonyms({ key, list: [] })
    );
    return () => {
      live = false;
    };
    // `context` is rebuilt on every reposition; its content is `contextKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextKey, lookup]);
  const loading = Boolean(context) && synonyms?.key !== contextKey;
  const list = context && !loading && synonyms ? synonyms.list : [];
  const { shown: chips, rest } = splitSynonyms(list);

  // The overflow list is open for one selection only.
  const [openKey, setOpenKey] = useState<string | null>(null);
  const open = Boolean(menu) && rest.length > 0 && openKey === menu?.key;

  // Place the menu once it has a size, before it is painted.
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar || !shown) return;
    const next = placeMenu({
      startTop: shown.startTop,
      endBottom: shown.endBottom,
      centerX: shown.centerX,
      menu: { width: bar.offsetWidth, height: bar.offsetHeight },
      minLeft: shown.minLeft,
      maxRight: shown.maxRight,
      minTop: shown.minTop,
    });
    setPos((was) =>
      was && was.top === next.top && was.left === next.left && was.placement === next.placement ? was : next
    );
  }, [shown, loading, chips.length, rest.length]);

  // Roving tabindex: one stop in the Tab order, the arrow keys move within.
  const activeRef = useRef(0);
  useLayoutEffect(() => {
    const items = barRef.current?.querySelectorAll<HTMLElement>("[data-roving]");
    items?.forEach((el, i) => {
      el.tabIndex = i === activeRef.current ? 0 : -1;
    });
  });

  const rovingItems = () => Array.from(barRef.current?.querySelectorAll<HTMLElement>("[data-roving]") ?? []);

  useEffect(() => {
    if (focusRequest === 0 || !menu) return;
    const items = rovingItems();
    activeRef.current = 0;
    items[0]?.focus();
    // Only a new request moves focus, not every reposition of the menu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest]);

  useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLElement>("[role=option]")?.focus();
  }, [open]);

  function onBarKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onEscape();
      return;
    }
    if (event.key === "ArrowDown" && event.target === moreRef.current && rest.length > 0) {
      event.preventDefault();
      setOpenKey(menu?.key ?? null);
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const items = rovingItems();
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next = nextIndex(Math.max(current, 0), items.length, event.key);
    if (next === null) return;
    event.preventDefault();
    activeRef.current = next;
    items[next]?.focus();
  }

  function onListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const options = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[role=option]") ?? []);
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      setOpenKey(null);
      moreRef.current?.focus();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const current = options.indexOf(document.activeElement as HTMLElement);
    const next = nextIndex(Math.max(current, 0), options.length, event.key);
    if (next === null) return;
    event.preventDefault();
    options[next]?.focus();
  }

  function onFocusEvent(event: FocusEvent<HTMLDivElement>) {
    const items = rovingItems();
    const at = items.indexOf(event.target as HTMLElement);
    if (at >= 0) activeRef.current = at;
    onFocusChange(true);
  }

  function onBlurEvent(event: FocusEvent<HTMLDivElement>) {
    if (!wrapRef.current?.contains(event.relatedTarget as Node | null)) onFocusChange(false);
  }

  if (!mounted || !shown) return null;
  const placement = pos?.placement ?? "above";
  // The overflow list opens upward only when the page has room for all of it
  // above the menu; otherwise it drops over the text below.
  const listUp = pos !== null && placement === "above" && pos.top - shown.minTop >= listHeight(rest.length);
  const first = shown.actions[0];

  return (
    <div
      ref={wrapRef}
      className="selection-menu"
      data-state={state}
      data-placement={placement}
      data-list={listUp ? "up" : "down"}
      data-compact={shown.maxRight - shown.minLeft < COMPACT_BELOW ? "true" : undefined}
      style={{
        maxWidth: shown.maxRight - shown.minLeft,
        ...(pos ? { top: pos.top, left: pos.left } : { visibility: "hidden", top: 0, left: 0 }),
      }}
      // Keep the caret and the selection in the page while the writer clicks.
      onMouseDown={(event) => event.preventDefault()}
      onFocus={onFocusEvent}
      onBlur={onBlurEvent}
      inert={state === "closed"}
    >
      <div
        ref={barRef}
        className="selection-menu-bar"
        role="toolbar"
        aria-label="Selection actions"
        aria-keyshortcuts="Control+K Meta+K"
        onKeyDown={onBarKeyDown}
      >
        <div className="selection-menu-actions">
          {shown.actions.map((action) => (
            <button
              key={action}
              type="button"
              className="selection-menu-btn"
              data-roving
              data-action={action}
              aria-label={ACTION_LABELS[action]}
              title={action === first ? `${ACTION_HINTS[action]} (${shortcut} moves here)` : ACTION_HINTS[action]}
              onClick={() => onAction(action)}
            >
              {ICONS[action]}
              <span className="selection-menu-label">{ACTION_LABELS[action]}</span>
            </button>
          ))}
        </div>
        {shown.context && loading ? (
          <div className="selection-menu-chips" aria-busy="true" aria-label="Loading synonyms">
            <span className="selection-menu-skeleton" aria-hidden="true" />
            <span className="selection-menu-skeleton" aria-hidden="true" />
            <span className="selection-menu-skeleton" aria-hidden="true" />
          </div>
        ) : null}
        {shown.context && !loading && chips.length > 0 ? (
          <div className="selection-menu-chips" role="group" aria-label="Synonyms">
            {chips.map((synonym) => (
              <button
                key={synonym}
                type="button"
                className="selection-menu-chip"
                data-roving
                onClick={() => onSynonym(synonym, false)}
              >
                {synonym}
              </button>
            ))}
            {rest.length > 0 ? (
              <button
                ref={moreRef}
                type="button"
                className="selection-menu-chip selection-menu-more"
                data-roving
                aria-haspopup="listbox"
                aria-expanded={open}
                onClick={() => setOpenKey(open ? null : (menu?.key ?? null))}
              >
                {`${rest.length} more...`}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {open ? (
        <div
          ref={listRef}
          className="selection-menu-list"
          role="listbox"
          aria-label="More synonyms"
          onKeyDown={onListKeyDown}
        >
          {rest.map((synonym) => (
            <button
              key={synonym}
              type="button"
              role="option"
              aria-selected="false"
              tabIndex={-1}
              className="selection-menu-option"
              onClick={() => {
                setOpenKey(null);
                onSynonym(synonym, true);
              }}
            >
              {synonym}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
