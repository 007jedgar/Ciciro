"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import { BlockId } from "@/lib/tiptap-block-id";
import {
  Suggestion,
  countSuggestionGroups,
  suggestionIdAt,
} from "@/lib/tiptap-suggestion";
import {
  newSuggestionId,
  splitDraftParagraphs,
  trackedDiffHtml,
  trackedInsertInlineHtml,
} from "@/lib/tracked-changes";
import { useSettings } from "@/components/SettingsProvider";

export type EditorHandle = {
  // `key` groups related inserts (e.g. one per chat message) so that
  // inserting a second option from the same message lands right after the
  // first instead of wherever the cursor happens to be. Omit it for a
  // one-off insert at the current cursor.
  insertDraft: (text: string, key?: string) => void;
  getSelection: () => string;
  focus: () => void;
  /** Put the caret at the end of the document (for Auto-mode chapter switches). */
  focusEnd: () => void;
  setReadingPosition: (blockId: string, offset: number) => void;
};

type ReadingCaret = { blockId: string; offset: number };

type Props = {
  content: string;
  onChange: (html: string) => void;
  onSelectionChange?: (text: string) => void;
  onCaretChange?: (caret: ReadingCaret) => void;
  restorePosition?: ReadingCaret | null;
  /** When true on mount, place the caret at the end (AI opened this chapter). */
  focusEndOnMount?: boolean;
};

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
  { content, onChange, onSelectionChange, onCaretChange, restorePosition, focusEndOnMount },
  ref
) {
  const { settings } = useSettings();
  const insertPositions = useRef<Map<string, number>>(new Map());
  const lastRange = useRef<{ from: number; to: number } | null>(null);
  const restoredKey = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onCaretChangeRef = useRef(onCaretChange);
  onChangeRef.current = onChange;
  onSelectionChangeRef.current = onSelectionChange;
  onCaretChangeRef.current = onCaretChange;
  const [pendingCount, setPendingCount] = useState(0);
  const [activeSuggestionId, setActiveSuggestionId] = useState<string | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      BlockId,
      Suggestion,
      CharacterCount,
      Placeholder.configure({
        placeholder: "Begin your chapter. Ciciro is reading over your shoulder...",
      }),
    ],
    content: content || "",
    onCreate: ({ editor: instance }) => {
      setPendingCount(countSuggestionGroups(instance.state.doc));
      setActiveSuggestionId(suggestionIdAt(instance.state));
    },
    onUpdate: ({ editor: instance }) => {
      onChangeRef.current(instance.getHTML());
      setPendingCount(countSuggestionGroups(instance.state.doc));
      setActiveSuggestionId(suggestionIdAt(instance.state));
    },
    onSelectionUpdate: ({ editor: instance }) => {
      const { from, to } = instance.state.selection;
      if (from !== to) lastRange.current = { from, to };
      else if (instance.isFocused) lastRange.current = null;
      const onSel = onSelectionChangeRef.current;
      if (onSel) {
        const text = instance.state.doc.textBetween(from, to, "\n");
        onSel(text);
      }
      const onCaret = onCaretChangeRef.current;
      if (onCaret) {
        const caret = caretFromEditor(instance);
        if (caret) onCaret(caret);
      }
      setActiveSuggestionId(suggestionIdAt(instance.state));
    },
    onTransaction: ({ transaction }) => {
      if (!transaction.docChanged) return;
      const map = insertPositions.current;
      for (const [key, pos] of map) {
        map.set(key, transaction.mapping.map(pos));
      }
      const range = lastRange.current;
      if (!range) return;
      const from = transaction.mapping.map(range.from, 1);
      const to = transaction.mapping.map(range.to, -1);
      lastRange.current = from < to ? { from, to } : null;
    },
    editorProps: {
      attributes: {
        class: "prose-body",
        spellcheck: settings.autoCorrect ? "true" : "false",
      },
    },
  });

  // Swap content when the active chapter changes.
  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    if (content !== current) {
      editor.commands.setContent(content || "", false);
      setPendingCount(countSuggestionGroups(editor.state.doc));
      setActiveSuggestionId(suggestionIdAt(editor.state));
    }
  }, [content, editor]);

  useEffect(() => {
    if (!editor) return;
    editor.setOptions({
      editorProps: {
        attributes: {
          class: "prose-body",
          spellcheck: settings.autoCorrect ? "true" : "false",
        },
      },
    });
  }, [editor, settings.autoCorrect]);

  useEffect(() => {
    if (!editor || !focusEndOnMount) return;
    editor.commands.focus("end");
  }, [editor, focusEndOnMount]);

  useEffect(() => {
    if (!editor || focusEndOnMount) return;
    if (!restorePosition) return;
    const key = `${restorePosition.blockId}:${restorePosition.offset}`;
    if (restoredKey.current === key) return;
    restoredKey.current = key;
    let target: number | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (target != null) return false;
      if (node.attrs.blockId !== restorePosition.blockId) return;
      const start = pos + 1;
      const max = node.content.size;
      target = start + Math.min(Math.max(0, restorePosition.offset), max);
      return false;
    });
    if (target == null) return;
    editor.chain().focus().setTextSelection(target).run();
  }, [editor, restorePosition, focusEndOnMount]);

  useImperativeHandle(ref, () => ({
    insertDraft(text: string, key = "default") {
      if (!editor) return;
      const paragraphs = splitDraftParagraphs(text);
      if (paragraphs.length === 0) return;

      const map = insertPositions.current;
      const docSize = editor.state.doc.content.size;
      const stacked = map.has(key);
      const { from: selFrom, to: selTo } = editor.state.selection;
      const liveSelection = selFrom < selTo ? { from: selFrom, to: selTo } : null;
      const remembered = lastRange.current;
      const revisionRange =
        !stacked &&
        (liveSelection ||
          (remembered && remembered.from < remembered.to && remembered.to <= docSize
            ? remembered
            : null));

      const id = newSuggestionId();

      if (revisionRange) {
        const oldText = editor.state.doc.textBetween(
          revisionRange.from,
          revisionRange.to,
          "\n\n",
          "\n"
        );
        const html = trackedDiffHtml(oldText, text.trim(), id);
        editor
          .chain()
          .focus()
          .setTextSelection({ from: revisionRange.from, to: revisionRange.to })
          .deleteSelection()
          .insertContent(html)
          .run();
        lastRange.current = null;
        map.set(key, editor.state.selection.to);
        return;
      }

      const fallback = editor.state.selection.to;
      const pos = Math.max(0, Math.min(map.get(key) ?? fallback, editor.state.doc.content.size));

      const chain = editor.chain().focus().setTextSelection(pos);
      paragraphs.forEach((p, i) => {
        if (i > 0) chain.insertContent("<p></p>");
        chain.insertContent(trackedInsertInlineHtml(p, id));
      });
      chain.run();

      map.set(key, editor.state.selection.to);
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
  }));

  const focusedHunk = Boolean(activeSuggestionId && pendingCount > 1);
  const acceptLabel = focusedHunk || pendingCount === 1 ? "Accept" : "Accept all";
  const rejectLabel = focusedHunk || pendingCount === 1 ? "Reject" : "Reject all";
  const acceptThis = () => {
    if (!editor) return;
    if (focusedHunk) editor.commands.acceptSuggestion(activeSuggestionId!);
    else editor.commands.acceptAllSuggestions();
  };
  const rejectThis = () => {
    if (!editor) return;
    if (focusedHunk) editor.commands.rejectSuggestion(activeSuggestionId!);
    else editor.commands.rejectAllSuggestions();
  };

  return (
    <div className="editor-surface">
      {pendingCount > 0 && (
        <div className="suggestion-bar" role="toolbar" aria-label="Tracked changes">
          <span>
            {pendingCount} pending {pendingCount === 1 ? "edit" : "edits"}
          </span>
          <button
            type="button"
            className="btn small primary"
            onClick={acceptThis}
          >
            {acceptLabel}
          </button>
          <button type="button" className="btn small" onClick={rejectThis}>
            {rejectLabel}
          </button>
          {focusedHunk && (
            <>
              <button
                type="button"
                className="btn ghost small"
                onClick={() => editor?.commands.acceptAllSuggestions()}
              >
                Accept all
              </button>
              <button
                type="button"
                className="btn ghost small"
                onClick={() => editor?.commands.rejectAllSuggestions()}
              >
                Reject all
              </button>
            </>
          )}
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
});

export default Editor;
