"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Editor as TiptapEditor } from "@tiptap/core";
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
import { Screenplay, currentElement, setElement } from "@/lib/tiptap-screenplay";
import {
  SCREENPLAY_ELEMENTS,
  SCREENPLAY_ELEMENT_LABELS,
  classifyScreenplayLines,
  type ManuscriptKind,
  type ScreenplayElement,
} from "@/lib/manuscript-kind";
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
  /** Hold the page still: nothing can be typed while it is true. */
  readOnly?: boolean;
  /** The page can take writes (the handle's insert calls land). */
  onReady?: () => void;
  /** Fired with the word count whenever an accepted suggestion was Ciciro's. */
  onSuggestionsAccepted?: (words: number) => void;
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
    readOnly = false,
    onReady,
    onSuggestionsAccepted,
  },
  ref
) {
  const { settings } = useSettings();
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

  // Set once the writer has put the caret somewhere (or one was put back for them).
  const placedCaret = useRef(false);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      BlockId,
      SuggestionInsertion,
      SuggestionDeletion,
      TrackChanges,
      FlashHighlight,
      ReadAloudHighlight,
      CommentHighlights.configure({ onClick: (id) => onCommentClickRef.current?.(id) }),
      ...(kind === "screenplay" ? [Screenplay] : []),
      CharacterCount,
      Placeholder.configure({
        placeholder: PLACEHOLDERS[kind],
      }),
    ],
    content: content || "",
    onUpdate: ({ editor }) => onChangeRef.current(editor.getHTML()),
    onSelectionUpdate: ({ editor }) => {
      if (kind === "screenplay") setCurrentElement(currentElement(editor));
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
    },
    onTransaction: ({ editor, transaction }) => {
      if (transaction.docChanged || transaction.selectionSet) showSuggestionAt(editor);
      if (!transaction.docChanged) return;
      const map = insertPositions.current;
      for (const [key, pos] of map) {
        map.set(key, transaction.mapping.map(pos));
      }
    },
    onFocus: ({ editor }) => {
      placedCaret.current = true;
      showSuggestionAt(editor);
    },
    onBlur: () => showSuggestionAt(null),
    editorProps: {
      handleKeyDown: (view, event) => {
        if (event.key !== "Escape") return false;
        const id = suggestionAt(view.state);
        if (!id || dismissedSuggestion.current === id) return false;
        dismissedSuggestion.current = id;
        setActiveSuggestion(null);
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
        const lines = classifyScreenplayLines(text);
        if (lines.length === 0) return;
        const map = insertPositions.current;
        const docSize = editor.state.doc.content.size;
        const pos = Math.max(0, Math.min(map.get(key) ?? editor.state.selection.to, docSize));
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
          {SCREENPLAY_ELEMENTS.map((el) => (
            <button
              key={el}
              type="button"
              className={`btn small ${element === el ? "primary" : "ghost"}`}
              aria-pressed={element === el}
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
          <span className="screenplay-hint">Tab cycles, Enter continues</span>
        </div>
      ) : null}
      <EditorContent editor={editor} />
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
