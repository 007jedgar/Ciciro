"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import type { Node as PmNode } from "@tiptap/pm/model";
import { BlockId } from "@/lib/tiptap-block-id";
import { useSettings } from "@/components/SettingsProvider";
import { typewriterScrollDelta } from "@/lib/typewriter";

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
  /** `length` selects that many characters from the offset (a search hit). */
  restorePosition?: (ReadingCaret & { length?: number }) | null;
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

// Map an offset into a block's visible text (what search reports: text nodes
// joined, a hard break as one character) to a document position, walking into
// nested paragraphs of a quote or list item. `atEnd` keeps a boundary offset in
// the node it ends rather than the one the next character starts.
function textOffsetToPos(block: PmNode, blockPos: number, offset: number, atEnd: boolean): number {
  let remaining = Math.max(0, offset);
  let found: number | null = null;
  let last = blockPos + 1;
  block.descendants((child, pos) => {
    if (found != null) return false;
    const at = blockPos + 1 + pos;
    if (child.isText) {
      const len = child.text?.length ?? 0;
      if (remaining < len || (atEnd && remaining === len)) {
        found = at + remaining;
        return false;
      }
      remaining -= len;
      last = at + len;
    } else if (child.type.name === "hardBreak") {
      if (remaining === 0 && !atEnd) {
        found = at;
        return false;
      }
      remaining -= 1;
      last = at + 1;
    }
  });
  return found ?? last;
}

const Editor = forwardRef<EditorHandle, Props>(function Editor(
  { content, onChange, onSelectionChange, onCaretChange, restorePosition, focusEndOnMount },
  ref
) {
  const { settings } = useSettings();
  const insertPositions = useRef<Map<string, number>>(new Map());
  const restoredKey = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onCaretChangeRef = useRef(onCaretChange);
  onChangeRef.current = onChange;
  onSelectionChangeRef.current = onSelectionChange;
  onCaretChangeRef.current = onCaretChange;

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      BlockId,
      CharacterCount,
      Placeholder.configure({
        placeholder: "Begin your chapter. Ciciro is reading over your shoulder...",
      }),
    ],
    content: content || "",
    onUpdate: ({ editor }) => onChangeRef.current(editor.getHTML()),
    onSelectionUpdate: ({ editor }) => {
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
    onTransaction: ({ transaction }) => {
      if (!transaction.docChanged) return;
      const map = insertPositions.current;
      for (const [key, pos] of map) {
        map.set(key, transaction.mapping.map(pos));
      }
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
        if (delta !== 0) {
          pane.scrollBy({
            top: delta,
            behavior: document.documentElement.dataset.reduceMotion === "true" ? "auto" : "smooth",
          });
        }
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
    if (selection) {
      editor.chain().focus().setTextSelection(selection).scrollIntoView().run();
      return;
    }
    if (target == null) return;
    editor.chain().focus().setTextSelection(target).run();
  }, [editor, restorePosition, focusEndOnMount]);

  useImperativeHandle(ref, () => ({
    insertDraft(text: string, key = "default") {
      if (!editor) return;
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

  return <EditorContent editor={editor} />;
});

export default Editor;
