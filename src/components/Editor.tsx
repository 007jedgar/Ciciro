"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Editor as TiptapEditor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import { BlockId } from "@/lib/tiptap-block-id";
import { textOffsetToPos } from "@/lib/tiptap-text-offset";
import {
  CommentHighlights,
  setCommentHighlights,
  type CommentHighlight,
} from "@/lib/tiptap-comment-highlights";
import {
  Screenplay,
  acceptSuggestion,
  currentCueText,
  currentElement,
  currentTag,
  dualState,
  moveScene,
  sceneBlocks,
  screenplayStarterKit,
  setElement,
  toggleCueExtension,
  toggleDual,
  type DualState,
  type ScriptContext,
  type SuggestInfo,
} from "@/lib/tiptap-screenplay";
import {
  DEFAULT_PAGE_SETTINGS,
  ScreenplayPages,
  refreshPageMarkers,
  type ScreenplayPageSettings,
} from "@/lib/tiptap-screenplay-pages";
import {
  CUE_EXTENSIONS,
  SCREENPLAY_ELEMENTS,
  SCREENPLAY_ELEMENT_LABELS,
  SCRIPT_START,
  hasExtension,
  knownElement,
  parseCue,
  scenes,
  type PageCursor,
  type ScreenplayElement,
} from "@/lib/screenplay";
import { normalizeElement, parseScriptLines, type ManuscriptKind } from "@/lib/manuscript-kind";
import { SCRIPT_LANGUAGE_NOTE, elementShortcutLabel } from "@/lib/screenplay-view";
import BetaBadge from "@/components/BetaBadge";
import ScriptSuggest from "@/components/ScriptSuggest";
import { useSettings } from "@/components/SettingsProvider";
import { typewriterScrollDelta } from "@/lib/typewriter";
import { FlashHighlight, flashRanges } from "@/lib/tiptap-flash";
import { scrollDeltaTo, scrollPaneBy, tweenScrollBy } from "@/lib/editor-scroll";
import { MOTION_MS, motionMs } from "@/lib/motion";
import { SuggestionCard, type SuggestionDetail } from "@/components/TrackChanges";
import { ciciroAcceptedWordCount, type SuggestionAction, type SuggestionAuthor } from "@/lib/suggestions";
import { getAnalytics } from "@/lib/analytics-client";
import {
  DELETION_MARK,
  INSERTION_MARK,
  SuggestionDeletion,
  SuggestionInsertion,
  TrackChanges,
  resolveInEditor,
  resolvedRanges,
  suggestionAt,
  suggestionRanges,
} from "@/lib/tiptap-suggestions";
import {
  docSentences,
  highlightReadAloud as highlightDocSentence,
  ReadAloudHighlight,
  readAloudSentence as docSentenceAt,
  trackReadAloud,
  type DocSentence,
} from "@/lib/tts-doc";
import { dictationParts, prepareDictation } from "@/lib/dictation";
import SelectionMenu, { type SelectionMenuData } from "@/components/SelectionMenu";
import {
  matchCase,
  selectionActionsFor,
  selectionKind,
  synonymContext,
  synonymEligible,
  type SelectionActionId,
} from "@/lib/selection-menu";
import {
  anchorCenter,
  isMacPlatform,
  isMenuShortcut,
  MENU_EDGE,
  menuAnnouncement,
  shortcutLabel,
  wordRange,
} from "@/lib/selection-menu-view";
import { lookupSynonyms } from "@/lib/synonyms-client";

export type EditorHandle = {
  /** True once the page is mounted and can take the writes below. */
  isReady: () => boolean;
  /** Where the writer's caret is, to put it back after a remount; null when they never placed one. */
  getCaret: () => ReadingCaret | null;
  /** True while the page has keyboard focus. */
  hasFocus: () => boolean;
  // `key` groups related inserts (e.g. one per chat message) so that
  // inserting a second option from the same message lands right after the
  // first instead of wherever the cursor happens to be. Omit it for a
  // one-off insert at the current cursor.
  insertDraft: (text: string, key?: string) => void;
  /** Type a dictated phrase at the caret, replacing any selection. */
  insertDictation: (text: string, lang?: string) => void;
  getSelection: () => string;
  focus: () => void;
  /** Put the caret at the end of the document (for Auto-mode chapter switches). */
  focusEnd: () => void;
  setReadingPosition: (blockId: string, offset: number) => void;
  /** Put the caret at the start of scene `scene` (an index into the script's scenes) and bring it into view. */
  revealScene: (scene: number) => void;
  /** Move scene `from` to where scene `to` is; false when nothing moved. */
  moveScene: (from: number, to: number) => boolean;
  /** Accept or reject pending suggestions: the given ids, or all of them. */
  resolveSuggestions: (action: SuggestionAction, ids?: string[]) => void;
  /** Put the caret on a suggestion and scroll it into view. */
  revealSuggestion: (id: string) => void;
  /**
   * Sentences to read aloud (the selection when there is one, else the whole
   * chapter). They are tracked through edits until the reading ends.
   */
  beginReadAloud: () => { sentences: DocSentence[]; selection: boolean };
  /** A tracked sentence as it reads now, or null if it was deleted. */
  readAloudSentence: (index: number) => DocSentence | null;
  /** Highlight (and scroll to) the tracked sentence at `index`; null ends the reading. */
  highlightReadAloud: (index: number | null) => void;
};

type ReadingCaret = { blockId: string; offset: number };

type Props = {
  content: string;
  onChange: (html: string) => void;
  onSelectionChange?: (text: string) => void;
  onCaretChange?: (caret: ReadingCaret) => void;
  /** `length` selects that many characters from the offset (a search hit). */
  restorePosition?: (ReadingCaret & { length?: number; focus?: boolean }) | null;
  /** When true on mount, place the caret at the end (AI opened this chapter). */
  focusEndOnMount?: boolean;
  /** Cross-fade the page in (a version was just restored). */
  fadeIn?: boolean;
  /** Track the author's edits as suggestions instead of applying them. */
  suggesting?: boolean;
  suggestionAuthor?: SuggestionAuthor;
  onActiveSuggestionChange?: (id: string | null) => void;
  /** Beta reader comments to mark in the text. */
  commentHighlights?: CommentHighlight[];
  onCommentClick?: (id: string) => void;
  /** What is being written. Screenplays get elements; a novel is the default. */
  kind?: ManuscriptKind;
  /** A screenplay's page when this sequence begins, for the soft page-break markers. */
  pageStart?: PageCursor;
  /** A screenplay's own settings for the page: the dialogue-break notes, scene numbers, and where this sequence's numbering begins. */
  pageSettings?: ScreenplayPageSettings;
  /** The rest of the script and the story bible's names, for the names and places a line offers. */
  scriptContext?: () => ScriptContext | null;
  /** Whether the script's language is one script formatting covers; extensions are grayed out when not. */
  scriptSupported?: boolean;
  /** Hold the page still: nothing can be typed while it is true. */
  readOnly?: boolean;
  /** The page can take writes (the handle's insert calls land). */
  onReady?: () => void;
  /** Fired with the word count whenever an accepted suggestion was Ciciro's. */
  onSuggestionsAccepted?: (words: number) => void;
  /**
   * A button in the menu over highlighted text was pressed. Returns false when
   * the action could not start (the chat is still answering), true or nothing
   * otherwise.
   */
  onSelectionAction?: (action: SelectionActionId, text: string) => boolean | void;
};

const PLACEHOLDERS: Record<ManuscriptKind, string> = {
  novel: "Begin your chapter. Ciciro is reading over your shoulder...",
  screenplay: "INT. LOCATION - DAY",
  blog: "Start writing your post...",
  journal: "What is on your mind today?",
};

type ActiveSuggestion = { detail: SuggestionDetail; top: number; left: number };

/** Scroll a range to rest at 40% of the pane and pulse it. */
function revealRange(editor: TiptapEditor, from: number, to: number) {
  try {
    const pane = editor.view.dom.closest<HTMLElement>(".editor-pane");
    if (pane) {
      const coords = editor.view.coordsAtPos(from);
      const rect = pane.getBoundingClientRect();
      scrollPaneBy(pane, scrollDeltaTo(coords.top, coords.bottom, rect.top, rect.height));
    }
  } catch {
    /* position not renderable yet */
  }
  flashRanges(editor, [{ from, to }], "pulse");
}

const CARD_WIDTH = 320;

/** 12pt, in CSS pixels. */
const SCRIPT_FONT_PX = 16;
/** Courier is 0.6em a column, so the 60 column page is this many ems wide. */
const SCRIPT_COLUMN_EMS = 36;

/** How long a selection must hold still before the menu over it shows. */
const MENU_SETTLE_MS = 150;

/** What a suggestion adds and removes, read straight off the document marks. */
function suggestionDetail(editor: TiptapEditor, id: string): SuggestionDetail | null {
  let attrs: Record<string, unknown> | null = null;
  let inserted = "";
  let deleted = "";
  let lastParent: unknown = null;
  editor.state.doc.descendants((node, _pos, parent) => {
    if (!node.isText) return;
    for (const mark of node.marks) {
      const kind = mark.type.name;
      if ((kind !== INSERTION_MARK && kind !== DELETION_MARK) || mark.attrs.suggestionId !== id) continue;
      attrs = attrs ?? mark.attrs;
      const gap = lastParent && lastParent !== parent ? " " : "";
      lastParent = parent;
      if (kind === INSERTION_MARK) inserted += (inserted ? gap : "") + node.text;
      else deleted += (deleted ? gap : "") + node.text;
    }
  });
  if (!attrs) return null;
  const found = attrs as Record<string, unknown>;
  return {
    id,
    authorId: String(found.authorId ?? ""),
    authorName: String(found.authorName ?? ""),
    createdAt: String(found.createdAt ?? ""),
    inserted,
    deleted,
  };
}

function caretFromEditor(editor: {
  state: { selection: { $from: { depth: number; node: (depth: number) => { attrs: Record<string, unknown> }; start: (depth: number) => number; pos: number } } };
}): ReadingCaret | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    const blockId = node.attrs.blockId;
    if (typeof blockId === "string" && blockId) {
      return { blockId, offset: Math.max(0, $from.pos - $from.start(depth)) };
    }
  }
  return null;
}

const Editor = forwardRef<EditorHandle, Props>(function Editor(
  {
    content,
    onChange,
    onSelectionChange,
    onCaretChange,
    restorePosition,
    focusEndOnMount,
    fadeIn = false,
    suggesting = false,
    suggestionAuthor,
    onActiveSuggestionChange,
    commentHighlights,
    onCommentClick,
    kind = "novel",
    pageStart = SCRIPT_START,
    pageSettings = DEFAULT_PAGE_SETTINGS,
    scriptContext,
    scriptSupported = true,
    readOnly = false,
    onReady,
    onSuggestionsAccepted,
    onSelectionAction,
  },
  ref
) {
  const { settings } = useSettings();
  const mac = isMacPlatform(typeof navigator === "undefined" ? undefined : navigator.platform);
  const shellRef = useRef<HTMLDivElement>(null);
  const [activeSuggestion, setActiveSuggestion] = useState<ActiveSuggestion | null>(null);
  // Escape closes the card until the caret moves to a different suggestion.
  const dismissedSuggestion = useRef<string | null>(null);
  const onActiveSuggestionRef = useRef(onActiveSuggestionChange);
  onActiveSuggestionRef.current = onActiveSuggestionChange;
  const insertPositions = useRef<Map<string, number>>(new Map());
  const restoredKey = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onCaretChangeRef = useRef(onCaretChange);
  onChangeRef.current = onChange;
  onSelectionChangeRef.current = onSelectionChange;
  onCaretChangeRef.current = onCaretChange;
  const onCommentClickRef = useRef(onCommentClick);
  onCommentClickRef.current = onCommentClick;
  const commentHighlightsRef = useRef(commentHighlights);
  commentHighlightsRef.current = commentHighlights;

  const [element, setCurrentElement] = useState<ScreenplayElement | null>(null);
  const [dual, setDual] = useState<DualState>({ available: false, on: false });
  // The cue under the caret, for the extension buttons: which are lit, and whether there is a name to extend.
  const [cue, setCue] = useState<string | null>(null);
  // The names, places and times offered under the caret, while the page has focus.
  const [suggest, setSuggest] = useState<SuggestInfo | null>(null);
  const [languageNoteOpen, setLanguageNoteOpen] = useState(false);
  const scriptContextRef = useRef(scriptContext);
  scriptContextRef.current = scriptContext;
  const pageStartRef = useRef(pageStart);
  pageStartRef.current = pageStart;
  const pageSettingsRef = useRef(pageSettings);
  pageSettingsRef.current = pageSettings;

  // The menu over highlighted text. `dragging` holds it back while the writer
  // is still pulling out a selection, and `dismissedMenu` (the selection it was
  // closed over) keeps Escape from being undone by the next update.
  const [selectionMenu, setSelectionMenu] = useState<SelectionMenuData | null>(null);
  const selectionMenuRef = useRef<SelectionMenuData | null>(null);
  selectionMenuRef.current = selectionMenu;
  const [menuFocusRequest, setMenuFocusRequest] = useState(0);
  const menuFocused = useRef(false);
  const dragging = useRef(false);
  const dismissedMenu = useRef<string | null>(null);
  const menuTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshMenuRef = useRef<(delay?: number) => void>(() => {});
  const onSelectionActionRef = useRef(onSelectionAction);
  onSelectionActionRef.current = onSelectionAction;

  // Set once the writer has put the caret somewhere (or one was put back for them).
  const placedCaret = useRef(false);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      ...(kind === "screenplay" ? screenplayStarterKit() : [StarterKit]),
      BlockId,
      SuggestionInsertion,
      SuggestionDeletion,
      TrackChanges,
      FlashHighlight,
      ReadAloudHighlight,
      CommentHighlights.configure({ onClick: (id) => onCommentClickRef.current?.(id) }),
      ...(kind === "screenplay"
        ? [
            Screenplay.configure({
              context: () => scriptContextRef.current?.() ?? null,
              onSuggest: setSuggest,
            }),
            ScreenplayPages.configure({
              start: () => pageStartRef.current,
              settings: () => pageSettingsRef.current,
            }),
          ]
        : []),
      CharacterCount,
      Placeholder.configure({
        placeholder: PLACEHOLDERS[kind],
      }),
    ],
    content: content || "",
    onUpdate: ({ editor }) => {
      if (kind === "screenplay") setCue(currentCueText(editor));
      onChangeRef.current(editor.getHTML());
    },
    onSelectionUpdate: ({ editor }) => {
      if (kind === "screenplay") {
        setCurrentElement(knownElement(currentTag(editor)));
        setDual(dualState(editor));
        setCue(currentCueText(editor));
      }
      const onSel = onSelectionChangeRef.current;
      if (onSel) {
        const { from, to } = editor.state.selection;
        const text = editor.state.doc.textBetween(from, to, "\n");
        onSel(text);
      }
      const onCaret = onCaretChangeRef.current;
      if (onCaret) {
        const caret = caretFromEditor(editor);
        if (caret) onCaret(caret);
      }
      refreshMenuRef.current(MENU_SETTLE_MS);
    },
    onTransaction: ({ editor, transaction }) => {
      if (transaction.docChanged || transaction.selectionSet) showSuggestionAt(editor);
      if (!transaction.docChanged) return;
      refreshMenuRef.current(0);
      const map = insertPositions.current;
      for (const [key, pos] of map) {
        map.set(key, transaction.mapping.map(pos));
      }
    },
    onFocus: ({ editor }) => {
      placedCaret.current = true;
      showSuggestionAt(editor);
      refreshMenuRef.current(0);
    },
    onBlur: () => {
      showSuggestionAt(null);
      // Focus may be on its way into the menu: look once it has settled.
      setTimeout(() => refreshMenuRef.current(0), 0);
    },
    editorProps: {
      handleDOMEvents: {
        mousedown: () => {
          dragging.current = true;
          setSelectionMenu(null);
          return false;
        },
      },
      handleKeyDown: (view, event) => {
        if (isMenuShortcut(event) && selectionMenuRef.current) {
          event.preventDefault();
          setMenuFocusRequest((n) => n + 1);
          return true;
        }
        if (event.key !== "Escape") return false;
        const id = suggestionAt(view.state);
        if (id && dismissedSuggestion.current !== id) {
          dismissedSuggestion.current = id;
          setActiveSuggestion(null);
          return true;
        }
        const open = selectionMenuRef.current;
        if (!open) return false;
        // Closing the menu is this Escape's whole job: not focus mode's too.
        dismissedMenu.current = open.key;
        setSelectionMenu(null);
        event.stopPropagation();
        return true;
      },
      attributes: {
        class: kind === "screenplay" ? "prose-body screenplay" : "prose-body",
        spellcheck: settings.autoCorrect ? "true" : "false",
      },
    },
  });

  // The card for the suggestion under the caret, placed just below it.
  const showSuggestionAt = useCallback((ed: TiptapEditor | null) => {
    const at = ed && ed.isFocused ? suggestionAt(ed.state) : null;
    if (at !== dismissedSuggestion.current) dismissedSuggestion.current = null;
    const id = at && at !== dismissedSuggestion.current ? at : null;
    const range = id && ed ? suggestionRanges(ed.state.doc).get(id) : undefined;
    const detail = id && ed ? suggestionDetail(ed, id) : null;
    const shell = shellRef.current;
    if (!ed || !id || !range || !detail || !shell) {
      setActiveSuggestion(null);
      onActiveSuggestionRef.current?.(null);
      return;
    }
    const box = shell.getBoundingClientRect();
    const start = ed.view.coordsAtPos(range.from);
    const end = ed.view.coordsAtPos(range.to);
    const sameLine = Math.abs(start.top - end.top) < 4;
    const left = Math.max(0, Math.min((sameLine ? start.left : end.left - 160) - box.left, box.width - CARD_WIDTH));
    setActiveSuggestion({ detail, top: end.bottom - box.top + 8, left });
    onActiveSuggestionRef.current?.(id);
  }, []);

  // Work out whether the menu shows over the current selection, and where.
  const showMenuNow = useCallback((ed: TiptapEditor | null) => {
    const shell = shellRef.current;
    if (dragging.current) return;
    if (!ed || ed.isDestroyed || !shell) {
      setSelectionMenu(null);
      return;
    }
    const { selection } = ed.state;
    const { from, to } = selection;
    const text = ed.state.doc.textBetween(from, to, "\n");
    const kind = selectionKind(text);
    const key = `${from}:${to}`;
    if (dismissedMenu.current && dismissedMenu.current !== key) dismissedMenu.current = null;
    const inside = ed.isFocused || menuFocused.current;
    if (
      selection.empty ||
      !(selection instanceof TextSelection) ||
      kind === "none" ||
      !inside ||
      !ed.isEditable ||
      dismissedMenu.current === key
    ) {
      setSelectionMenu(null);
      return;
    }
    const box = shell.getBoundingClientRect();
    const start = ed.view.coordsAtPos(from);
    const end = ed.view.coordsAtPos(to);
    const pane = ed.view.dom.closest<HTMLElement>(".editor-pane");
    const paneBox = pane?.getBoundingClientRect();
    // Scrolled out of the page: nothing to point at.
    if (paneBox && (end.bottom < paneBox.top || start.top > paneBox.bottom)) {
      setSelectionMenu(null);
      return;
    }
    let context: SelectionMenuData["context"] = null;
    if (kind === "word" && selection.$from.sameParent(selection.$to)) {
      const range = wordRange(from, text);
      if (range && synonymEligible(range.word)) {
        const parent = selection.$from.parent;
        const block = parent.textBetween(0, parent.content.size, "\n", "\n");
        const offset = selection.$from.parentOffset + range.lead.length;
        const found = synonymContext(block, offset, offset + range.word.length);
        if (found.word === range.word) context = found;
      }
    }
    const next: SelectionMenuData = {
      key,
      target: kind,
      actions: selectionActionsFor(kind),
      startTop: Math.round(start.top - box.top),
      endBottom: Math.round(end.bottom - box.top),
      centerX: Math.round(anchorCenter(start.left, end.left) - box.left),
      // Never above the text: the page's own controls sit up there.
      minTop: paneBox ? Math.max(0, Math.round(paneBox.top - box.top)) : 0,
      minLeft: Math.round((paneBox ? paneBox.left - box.left : 0) + MENU_EDGE),
      maxRight: Math.round((paneBox ? paneBox.right - box.left : box.width) - MENU_EDGE),
      context,
    };
    setSelectionMenu((was) =>
      was &&
      was.key === next.key &&
      was.startTop === next.startTop &&
      was.endBottom === next.endBottom &&
      was.centerX === next.centerX &&
      was.minTop === next.minTop &&
      was.minLeft === next.minLeft &&
      was.maxRight === next.maxRight
        ? was
        : next
    );
  }, []);

  // A collapsed selection hides the menu at once; a live one waits `delay` so
  // the menu does not flicker while a selection is being extended by keys.
  refreshMenuRef.current = (delay = 0) => {
    if (menuTimer.current) clearTimeout(menuTimer.current);
    menuTimer.current = null;
    if (editor && !editor.isDestroyed && editor.state.selection.empty) {
      showMenuNow(editor);
      return;
    }
    if (delay <= 0) {
      showMenuNow(editor);
      return;
    }
    menuTimer.current = setTimeout(() => {
      menuTimer.current = null;
      showMenuNow(editor);
    }, delay);
  };

  useEffect(() => {
    return () => {
      if (menuTimer.current) clearTimeout(menuTimer.current);
    };
  }, []);

  // The writer let go of the mouse: the selection is theirs now.
  useEffect(() => {
    const up = () => {
      if (!dragging.current) return;
      dragging.current = false;
      refreshMenuRef.current(0);
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  // The menu follows its selection when the page scrolls or the window resizes.
  useEffect(() => {
    if (!editor) return;
    const pane = editor.view.dom.closest<HTMLElement>(".editor-pane");
    let frame = 0;
    const follow = () => {
      if (!selectionMenuRef.current || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        refreshMenuRef.current(0);
      });
    };
    pane?.addEventListener("scroll", follow, { passive: true });
    window.addEventListener("resize", follow);
    return () => {
      cancelAnimationFrame(frame);
      pane?.removeEventListener("scroll", follow);
      window.removeEventListener("resize", follow);
    };
  }, [editor]);

  const dismissMenu = useCallback(() => {
    const open = selectionMenuRef.current;
    if (open) dismissedMenu.current = open.key;
    setSelectionMenu(null);
  }, []);

  const onMenuAction = useCallback(
    (action: SelectionActionId) => {
      const open = selectionMenuRef.current;
      if (!editor || !open) return;
      const { from, to } = editor.state.selection;
      const text = editor.state.doc.textBetween(from, to, "\n");
      getAnalytics().track("selection_action_used", { action, target: open.target });
      dismissMenu();
      onSelectionActionRef.current?.(action, text);
      // Comment hands the keyboard to the chat; the rest leave it on the page.
      if (action !== "comment") editor.commands.focus();
    },
    [editor, dismissMenu]
  );

  // A synonym replaces just the word, so quotes and full stops around it stay.
  // It goes in as an ordinary edit: tracked like typing when Suggest is on.
  const onPickSynonym = useCallback(
    (synonym: string, more: boolean) => {
      const open = selectionMenuRef.current;
      if (!editor || editor.isDestroyed || !open?.context) return;
      const { state, view } = editor;
      const { from, to } = state.selection;
      const range = wordRange(from, state.doc.textBetween(from, to, "\n"));
      if (!range || range.word !== open.context.word) return;
      const next = matchCase(range.word, synonym);
      // The word's own bold, italic and so on carry over to what replaces it.
      const marks = state.doc.resolve(range.from + 1).marks();
      const tr = state.tr.replaceWith(range.from, range.to, state.schema.text(next, marks));
      tr.setSelection(TextSelection.create(tr.doc, range.from + next.length));
      view.dispatch(tr);
      view.focus();
      getAnalytics().track("synonym_used", { more });
    },
    [editor]
  );

  useEffect(() => {
    if (!editor) return;
    const storage = editor.storage.trackChanges as { suggesting: boolean; author: SuggestionAuthor };
    storage.suggesting = suggesting;
    if (suggestionAuthor) storage.author = suggestionAuthor;
  }, [editor, suggesting, suggestionAuthor]);

  const onSuggestionsAcceptedRef = useRef(onSuggestionsAccepted);
  onSuggestionsAcceptedRef.current = onSuggestionsAccepted;

  // Accepting drops the struck text and rejecting drops the inserted text: fold
  // that half away first, then apply the change and flash what stays.
  const resolving = useRef(false);
  const applyResolved = useCallback(
    async (action: SuggestionAction, ids?: string[]) => {
      if (!editor || resolving.current || !editor.isEditable) return;
      const shell = shellRef.current;
      const going = action === "accept" ? "del" : "ins";
      const wait = motionMs(MOTION_MS.suggestionCollapse);
      if (shell && wait > 0) {
        const wanted = ids ? new Set(ids) : null;
        const els = Array.from(
          shell.querySelectorAll<HTMLElement>(`.ProseMirror ${going}[data-suggestion-id]`)
        ).filter((el) => !wanted || wanted.has(el.getAttribute("data-suggestion-id") ?? ""));
        if (els.length > 0) {
          resolving.current = true;
          for (const el of els) {
            // A change that wraps lines just fades: it cannot fold sideways in one piece.
            if (el.getClientRects().length === 1) {
              el.style.setProperty("--w", `${el.getBoundingClientRect().width}px`);
              el.classList.add("suggestion-folding");
            } else {
              el.classList.add("suggestion-fading");
            }
          }
          await new Promise((resolve) => setTimeout(resolve, wait));
          resolving.current = false;
          if (editor.isDestroyed || !editor.isEditable) {
            for (const el of els) el.classList.remove("suggestion-folding", "suggestion-fading");
            return;
          }
        }
      }
      const kept = resolvedRanges(editor.state.doc, action, ids);
      // Accepting drops the marks that say these words were Ciciro's, so the
      // tally has to be taken from the HTML as it stands right now.
      const acceptedWords =
        action === "accept" ? ciciroAcceptedWordCount(editor.getHTML(), ids ?? null) : 0;
      if (!resolveInEditor(editor, action, ids)) return;
      getAnalytics().track(action === "accept" ? "suggestion_accepted" : "suggestion_rejected", {});
      if (acceptedWords > 0) onSuggestionsAcceptedRef.current?.(acceptedWords);
      const doc = editor.state.doc;
      flashRanges(
        editor,
        kept.filter((r) => r.to <= doc.content.size && doc.textBetween(r.from, r.to, "\n") === r.text),
        action === "accept" ? "accept" : "reject"
      );
    },
    [editor]
  );

  // Swap content when the active chapter changes.
  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    if (content !== current) {
      editor.commands.setContent(content || "", false);
      // Replacing the whole document drops the marks; place them again.
      setCommentHighlights(editor, commentHighlightsRef.current ?? []);
    }
  }, [content, editor]);

  useEffect(() => {
    if (!editor) return;
    editor.setOptions({
      editorProps: {
        attributes: {
          class: kind === "screenplay" ? "prose-body screenplay" : "prose-body",
          spellcheck: settings.autoCorrect ? "true" : "false",
        },
      },
    });
  }, [editor, kind, settings.autoCorrect]);

  // The markers follow the page this sequence starts on, which moves when an
  // earlier sequence grows or shrinks.
  useEffect(() => {
    if (editor && kind === "screenplay") refreshPageMarkers(editor);
  }, [
    editor,
    kind,
    pageStart.page,
    pageStart.line,
    pageSettings.more,
    pageSettings.contd,
    pageSettings.sceneNumbers,
    pageSettings.scenesBefore,
  ]);

  // A script is always 12pt Courier on a 60 column page, whatever the editor
  // font settings say. A column narrower than the page scales the whole page
  // down together (every width is in `ch`), so lines still break where the
  // printed page breaks them.
  useEffect(() => {
    const shell = shellRef.current;
    if (kind !== "screenplay" || !shell || typeof ResizeObserver === "undefined") return;
    const fit = () => {
      const width = shell.clientWidth;
      if (width > 0) shell.style.setProperty("--screenplay-size", `${Math.min(SCRIPT_FONT_PX, width / SCRIPT_COLUMN_EMS)}px`);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(shell);
    return () => observer.disconnect();
  }, [kind]);

  // Typewriter mode: keep the caret line vertically centered in the scroll pane.
  useEffect(() => {
    if (!editor || !settings.typewriterMode) return;
    const center = () => {
      if (!editor.isFocused) return;
      const pane = editor.view.dom.closest<HTMLElement>(".editor-pane");
      if (!pane) return;
      try {
        const coords = editor.view.coordsAtPos(editor.state.selection.head);
        const rect = pane.getBoundingClientRect();
        const delta = typewriterScrollDelta(coords.top, coords.bottom, rect.top, rect.height);
        // A short ease rather than a jump. Driven by hand: ProseMirror's own
        // scroll-into-view on each keystroke would cancel the browser's smooth scroll.
        tweenScrollBy(pane, delta, MOTION_MS.typewriter);
      } catch {
        /* position not renderable yet */
      }
    };
    editor.on("selectionUpdate", center);
    editor.on("update", center);
    editor.on("focus", center);
    center();
    return () => {
      editor.off("selectionUpdate", center);
      editor.off("update", center);
      editor.off("focus", center);
    };
  }, [editor, settings.typewriterMode]);

  useEffect(() => {
    if (!editor) return;
    setCommentHighlights(editor, commentHighlights ?? []);
  }, [editor, commentHighlights]);

  useEffect(() => {
    if (!editor) return;
    if (editor.isEditable !== !readOnly) editor.setEditable(!readOnly, false);
  }, [editor, readOnly]);

  useEffect(() => {
    if (!editor || !focusEndOnMount) return;
    editor.commands.focus("end");
  }, [editor, focusEndOnMount]);

  useEffect(() => {
    if (!editor || focusEndOnMount) return;
    if (!restorePosition) return;
    const key = `${restorePosition.blockId}:${restorePosition.offset}:${restorePosition.length ?? 0}`;
    if (restoredKey.current === key) return;
    restoredKey.current = key;
    const length = restorePosition.length ?? 0;
    let target: number | null = null;
    let selection: { from: number; to: number } | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (target != null || selection != null) return false;
      if (node.attrs.blockId !== restorePosition.blockId) return;
      if (length > 0) {
        selection = {
          from: textOffsetToPos(node, pos, restorePosition.offset, false),
          to: textOffsetToPos(node, pos, restorePosition.offset + length, true),
        };
        return false;
      }
      const start = pos + 1;
      const max = node.content.size;
      target = start + Math.min(Math.max(0, restorePosition.offset), max);
      return false;
    });
    placedCaret.current = placedCaret.current || target != null || selection != null;
    const focus = restorePosition.focus !== false;
    if (selection) {
      const hit = selection as { from: number; to: number };
      const chain = editor.chain();
      if (focus) chain.focus(undefined, { scrollIntoView: false });
      chain.setTextSelection(hit).run();
      // Glide to the hit and pulse it, so it is clear where the search landed.
      requestAnimationFrame(() => {
        if (editor.isDestroyed) return;
        revealRange(editor, hit.from, hit.to);
      });
      return;
    }
    if (target == null) return;
    if (focus) editor.chain().focus().setTextSelection(target).run();
    else editor.commands.setTextSelection(target);
  }, [editor, restorePosition, focusEndOnMount]);

  // After the caret has been put back, so held writes land where the writer was.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  useEffect(() => {
    if (editor) onReadyRef.current?.();
  }, [editor]);

  useImperativeHandle(ref, () => ({
    isReady: () => Boolean(editor && !editor.isDestroyed),
    getCaret: () => (editor && !editor.isDestroyed && placedCaret.current ? caretFromEditor(editor) : null),
    hasFocus: () => Boolean(editor && !editor.isDestroyed && editor.isFocused),
    insertDraft(text: string, key = "default") {
      if (!editor) return;
      if (kind === "screenplay") {
        const map = insertPositions.current;
        const docSize = editor.state.doc.content.size;
        const pos = Math.max(0, Math.min(map.get(key) ?? editor.state.selection.to, docSize));
        // Read on from the line the draft lands under, so one that opens with
        // dialogue under a cue is dialogue.
        const { doc } = editor.state;
        const $pos = doc.resolve(pos);
        const above =
          $pos.depth === 0
            ? $pos.nodeBefore
            : $pos.parentOffset > 0
              ? $pos.parent
              : $pos.index(0) > 0
                ? doc.child($pos.index(0) - 1)
                : null;
        const lines = parseScriptLines(
          text,
          above?.type.name === "paragraph" ? normalizeElement(above.attrs.screenplay) : undefined
        );
        if (lines.length === 0) return;
        editor
          .chain()
          .focus()
          .setTextSelection(pos)
          .insertContent(
            lines.map(({ element: el, text: line }) => ({
              type: "paragraph",
              attrs: { screenplay: el === "action" ? null : el },
              content: [{ type: "text", text: line }],
            }))
          )
          .run();
        map.set(key, editor.state.selection.to);
        return;
      }
      const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
      if (paragraphs.length === 0) return;

      // Resume at this key's tracked position if it has one; otherwise fall
      // back to the current cursor, same as a plain one-off insert.
      const map = insertPositions.current;
      const docSize = editor.state.doc.content.size;
      const fallback = editor.state.selection.to;
      const pos = Math.max(0, Math.min(map.get(key) ?? fallback, docSize));

      const chain = editor.chain().focus().setTextSelection(pos);
      paragraphs.forEach((p, i) => {
        if (i > 0) chain.insertContent("<p></p>");
        chain.insertContent(p.replace(/\n/g, "<br>"));
      });
      chain.run();

      // Remember where this group left off so the next insert for the same
      // key (e.g. another option from the same message) continues here.
      map.set(key, editor.state.selection.to);
    },
    insertDictation(text: string, lang = "en") {
      if (!editor) return;
      const { $from, $to } = editor.state.selection;
      const before = $from.parent.textBetween(0, $from.parentOffset, "\n", "\n").slice(-3);
      const after = $to.parent
        .textBetween($to.parentOffset, $to.parent.content.size, "\n", "\n")
        .slice(0, 3);
      const prepared = prepareDictation(text, before, lang, after);
      if (!prepared) return;
      const chain = editor.chain().focus();
      for (const part of dictationParts(prepared)) {
        if (part.type === "text") chain.insertContent({ type: "text", text: part.text });
        else if (part.type === "paragraph") chain.splitBlock();
        else chain.setHardBreak();
      }
      chain.scrollIntoView().run();
    },
    getSelection() {
      if (!editor) return "";
      const { from, to } = editor.state.selection;
      return editor.state.doc.textBetween(from, to, "\n");
    },
    focus() {
      editor?.commands.focus();
    },
    focusEnd() {
      editor?.commands.focus("end");
    },
    beginReadAloud() {
      if (!editor) return { sentences: [], selection: false };
      const { from, to, empty } = editor.state.selection;
      let result = { sentences: docSentences(editor.state.doc), selection: false };
      if (!empty) {
        const sentences = docSentences(editor.state.doc, { from, to });
        if (sentences.length > 0) result = { sentences, selection: true };
      }
      trackReadAloud(editor.view, result.sentences);
      return result;
    },
    readAloudSentence(index) {
      if (!editor || editor.isDestroyed) return null;
      return docSentenceAt(editor.state, index);
    },
    highlightReadAloud(index) {
      if (!editor || editor.isDestroyed) return;
      highlightDocSentence(editor.view, index);
      const range = index === null ? null : docSentenceAt(editor.state, index);
      if (!range) return;
      try {
        const pane = editor.view.dom.closest<HTMLElement>(".editor-pane");
        if (!pane) return;
        const coords = editor.view.coordsAtPos(range.from);
        const rect = pane.getBoundingClientRect();
        // Keep the sentence being read at 40% of the pane, so the eye stays put
        // while the page moves under it.
        scrollPaneBy(pane, scrollDeltaTo(coords.top, coords.bottom, rect.top, rect.height, 0.4, 24));
      } catch {
        /* position not renderable yet */
      }
    },
    setReadingPosition(blockId: string, offset: number) {
      if (!editor) return;
      let target: number | null = null;
      editor.state.doc.descendants((node, pos) => {
        if (target != null) return false;
        if (node.attrs.blockId !== blockId) return;
        const start = pos + 1;
        const max = node.content.size;
        target = start + Math.min(Math.max(0, offset), max);
        return false;
      });
      if (target == null) return;
      editor.chain().focus().setTextSelection(target).run();
    },
    revealScene(scene: number) {
      if (!editor) return;
      const range = scenes(sceneBlocks(editor))[scene];
      if (!range) return;
      let at: { from: number; to: number } | null = null;
      editor.state.doc.forEach((node, offset, index) => {
        if (index === range.start) at = { from: offset + 1, to: offset + 1 + node.content.size };
      });
      if (!at) return;
      const { from, to } = at as { from: number; to: number };
      editor.chain().focus(undefined, { scrollIntoView: false }).setTextSelection(from).run();
      revealRange(editor, from, to);
    },
    moveScene(from: number, to: number) {
      return editor ? moveScene(editor, from, to) : false;
    },
    resolveSuggestions(action: SuggestionAction, ids?: string[]) {
      applyResolved(action, ids);
    },
    revealSuggestion(id: string) {
      if (!editor) return;
      const range = suggestionRanges(editor.state.doc).get(id);
      if (!range) return;
      editor.chain().focus(undefined, { scrollIntoView: false }).setTextSelection(range.from).run();
      revealRange(editor, range.from, range.to);
    },
  }));

  return (
    <div
      ref={shellRef}
      className={`editor-shell${suggesting ? " is-suggesting" : ""}${fadeIn ? " fade-in" : ""}`}
    >
      {kind === "screenplay" ? (
        <div className="screenplay-bar" role="toolbar" aria-label="Screenplay element">
          <BetaBadge />
          {SCREENPLAY_ELEMENTS.map((el) => (
            <button
              key={el}
              type="button"
              className={`btn small ${element === el ? "primary" : "ghost"}`}
              aria-pressed={element === el}
              aria-keyshortcuts={elementShortcutLabel(el, mac, "aria")}
              title={`${SCREENPLAY_ELEMENT_LABELS[el]} (${elementShortcutLabel(el, mac)})`}
              disabled={readOnly}
              // Keep the caret in the page while picking an element.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                if (!editor || !editor.isEditable) return;
                setElement(editor, el);
                setCurrentElement(currentElement(editor));
              }}
            >
              {SCREENPLAY_ELEMENT_LABELS[el]}
            </button>
          ))}
          <button
            type="button"
            className={`btn small ${dual.on ? "primary" : "ghost"}`}
            aria-pressed={dual.on}
            aria-keyshortcuts={mac ? "Alt+Shift+D" : "Alt+Shift+D"}
            title={`Dual dialogue: set this speech beside the one above it (${mac ? "⌥⇧D" : "Alt+Shift+D"})`}
            disabled={readOnly || !dual.available}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              if (!editor || !editor.isEditable) return;
              toggleDual(editor);
              setDual(dualState(editor));
              editor.commands.focus();
            }}
          >
            Dual
          </button>
          <div className="screenplay-extensions" role="group" aria-label="Cue extensions">
            {CUE_EXTENSIONS.map((ext) => {
              const named = cue !== null && parseCue(cue).name !== "";
              const lit = cue !== null && hasExtension(cue, ext);
              return (
                <button
                  key={ext}
                  type="button"
                  className={`btn small ${lit ? "primary" : "ghost"}`}
                  aria-pressed={lit}
                  title={`Add or remove (${ext}) on the cue`}
                  disabled={readOnly || !scriptSupported || !named}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    if (!editor || !editor.isEditable) return;
                    toggleCueExtension(editor, ext);
                    setCue(currentCueText(editor));
                  }}
                >
                  {ext}
                </button>
              );
            })}
            {!scriptSupported ? (
              <button
                type="button"
                className="export-info"
                aria-label="Why are the cue extensions unavailable?"
                aria-expanded={languageNoteOpen}
                aria-controls="script-language-note"
                onClick={() => setLanguageNoteOpen((open) => !open)}
              >
                i
              </button>
            ) : null}
          </div>
          <span className="screenplay-hint">Tab moves on, Enter continues</span>
          {!scriptSupported && languageNoteOpen ? (
            <p id="script-language-note" className="export-language-note" role="note">
              {SCRIPT_LANGUAGE_NOTE}
            </p>
          ) : null}
        </div>
      ) : null}
      <EditorContent editor={editor} />
      {kind === "screenplay" && suggest ? (
        <ScriptSuggest
          info={suggest}
          shell={shellRef.current}
          onPick={(index) => {
            if (editor) acceptSuggestion(editor, index);
          }}
        />
      ) : null}
      <SelectionMenu
        menu={selectionMenu}
        lookup={lookupSynonyms}
        onAction={onMenuAction}
        onSynonym={onPickSynonym}
        onEscape={() => {
          dismissMenu();
          editor?.commands.focus();
        }}
        onFocusChange={(inside) => {
          menuFocused.current = inside;
          if (!inside) refreshMenuRef.current(0);
        }}
        focusRequest={menuFocusRequest}
        shortcut={shortcutLabel(mac)}
      />
      <div className="selection-menu-live" role="status" aria-live="polite">
        {selectionMenu ? menuAnnouncement(mac) : ""}
      </div>
      {activeSuggestion ? (
        <SuggestionCard
          detail={activeSuggestion.detail}
          top={activeSuggestion.top}
          left={activeSuggestion.left}
          onAccept={() => applyResolved("accept", [activeSuggestion.detail.id])}
          onReject={() => applyResolved("reject", [activeSuggestion.detail.id])}
        />
      ) : null}
    </div>
  );
});

export default Editor;
