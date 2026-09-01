"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import { BlockId } from "@/lib/tiptap-block-id";

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
};

type Props = {
  content: string;
  onChange: (html: string) => void;
  onSelectionChange?: (text: string) => void;
  /** When true on mount, place the caret at the end (AI opened this chapter). */
  focusEndOnMount?: boolean;
};

const Editor = forwardRef<EditorHandle, Props>(function Editor(
  { content, onChange, onSelectionChange, focusEndOnMount },
  ref
) {
  // Tracks the next insertion point per group key, so a second insert for
  // the same key continues where the last one left off rather than jumping
  // to wherever the live cursor is now. Remapped through every transaction
  // so it stays valid even if the user edits elsewhere in the meantime.
  const insertPositions = useRef<Map<string, number>>(new Map());

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
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    onSelectionUpdate: ({ editor }) => {
      if (!onSelectionChange) return;
      const { from, to } = editor.state.selection;
      const text = editor.state.doc.textBetween(from, to, "\n");
      onSelectionChange(text);
    },
    onTransaction: ({ transaction }) => {
      if (!transaction.docChanged) return;
      const map = insertPositions.current;
      for (const [key, pos] of map) {
        map.set(key, transaction.mapping.map(pos));
      }
    },
    editorProps: {
      attributes: { class: "prose-body" },
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
    if (!editor || !focusEndOnMount) return;
    editor.commands.focus("end");
  }, [editor, focusEndOnMount]);

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
  }));

  return <EditorContent editor={editor} />;
});

export default Editor;
