// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TextSelection } from "@tiptap/pm/state";
import { BlockId } from "@/lib/tiptap-block-id";
import {
  SuggestionDeletion,
  SuggestionInsertion,
  TrackChanges,
  resolveInEditor,
  suggestionAt,
  suggestionRanges,
} from "@/lib/tiptap-suggestions";
import {
  CICIRO_AUTHOR,
  listSuggestions,
  resolveSuggestions,
  suggestReplacements,
  type SuggestionAuthor,
} from "@/lib/suggestions";

const AUTHOR: SuggestionAuthor = { authorId: "user-1", authorName: "Mara Quill" };
const editors: Editor[] = [];

function makeEditor(content: string, suggesting = true): Editor {
  const editor = new Editor({
    extensions: [StarterKit, BlockId, SuggestionInsertion, SuggestionDeletion, TrackChanges],
    content,
  });
  const storage = editor.storage.trackChanges as { suggesting: boolean; author: SuggestionAuthor };
  storage.suggesting = suggesting;
  storage.author = AUTHOR;
  editors.push(editor);
  return editor;
}

/** Document position of the `index`-th character of the first paragraph. */
function at(index: number): number {
  return 1 + index;
}

function type(editor: Editor, text: string) {
  for (const ch of text) {
    const { from, to } = editor.state.selection;
    editor.view.dispatch(editor.state.tr.insertText(ch, from, to));
  }
}

function backspace(editor: Editor) {
  const { from } = editor.state.selection;
  editor.view.dispatch(editor.state.tr.delete(from - 1, from));
}

function select(editor: Editor, from: number, to = from) {
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)));
}

afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
});

describe("suggest mode in the desk editor", () => {
  it("applies edits directly when suggest mode is off", () => {
    const editor = makeEditor('<p data-block-id="a">The cat sat.</p>', false);
    select(editor, at(7));
    type(editor, "s");
    expect(editor.getHTML()).toBe('<p data-block-id="a">The cats sat.</p>');
  });

  it("tracks typed text as one insertion by the author", () => {
    const editor = makeEditor('<p data-block-id="a">The cat sat.</p>');
    select(editor, at(4));
    type(editor, "big ");
    const [suggestion] = listSuggestions(editor.getHTML());
    expect(suggestion).toMatchObject({ authorId: "user-1", authorName: "Mara Quill", inserted: "big", deleted: "" });
    expect(listSuggestions(editor.getHTML())).toHaveLength(1);
    expect(resolveSuggestions(editor.getHTML(), "reject")).toBe('<p data-block-id="a">The cat sat.</p>');
    expect(resolveSuggestions(editor.getHTML(), "accept")).toBe('<p data-block-id="a">The big cat sat.</p>');
  });

  it("strikes deleted text instead of removing it and walks the caret back", () => {
    const editor = makeEditor('<p data-block-id="a">The cat sat.</p>');
    select(editor, at(7));
    backspace(editor);
    backspace(editor);
    backspace(editor);
    const html = editor.getHTML();
    expect(listSuggestions(html)).toHaveLength(1);
    expect(listSuggestions(html)[0]).toMatchObject({ deleted: "cat", inserted: "" });
    expect(editor.state.selection.from).toBe(at(4));
    expect(resolveSuggestions(html, "accept")).toBe('<p data-block-id="a">The  sat.</p>');
    expect(resolveSuggestions(html, "reject")).toBe('<p data-block-id="a">The cat sat.</p>');
  });

  it("records a typed-over selection as one replacement", () => {
    const editor = makeEditor('<p data-block-id="a">The cat sat.</p>');
    select(editor, at(4), at(7));
    type(editor, "dog");
    const list = listSuggestions(editor.getHTML());
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ deleted: "cat", inserted: "dog" });
    expect(editor.getHTML()).toContain("</del><ins");
  });

  it("really deletes text the author only proposed", () => {
    const editor = makeEditor('<p data-block-id="a">The cat sat.</p>');
    select(editor, at(4));
    type(editor, "big ");
    backspace(editor);
    backspace(editor);
    backspace(editor);
    backspace(editor);
    expect(editor.getHTML()).toBe('<p data-block-id="a">The cat sat.</p>');
  });

  it("does not track content arriving from the server", () => {
    const editor = makeEditor('<p data-block-id="a">The cat sat.</p>');
    editor.commands.setContent('<p data-block-id="a">The dog sat.</p>', false);
    expect(editor.getHTML()).toBe('<p data-block-id="a">The dog sat.</p>');
  });

  it("undoes and redoes a tracked edit without tracking it twice", () => {
    const editor = makeEditor('<p data-block-id="a">The cat sat.</p>');
    select(editor, at(4), at(7));
    type(editor, "dog");
    const tracked = editor.getHTML();
    editor.commands.undo();
    expect(editor.getHTML()).toBe('<p data-block-id="a">The cat sat.</p>');
    editor.commands.redo();
    expect(editor.getHTML()).toBe(tracked);
  });

  it("keeps new text out of a struck-through run when editing directly", () => {
    const pending = suggestReplacements('<p data-block-id="a">The cat sat.</p>', [{ find: "cat", replace: "" }], {
      author: CICIRO_AUTHOR,
    }).html;
    const editor = makeEditor(pending, false);
    select(editor, at(5));
    type(editor, "X");
    expect(resolveSuggestions(editor.getHTML(), "accept")).toBe('<p data-block-id="a">The X sat.</p>');
  });

  it("round-trips the shared serializer's HTML byte-for-byte", () => {
    const { html } = suggestReplacements(
      '<p data-block-id="a">She walked <em>slowly</em> to the <strong>door</strong>.</p>',
      [{ find: "walked slowly to the door", replace: "ambled to the gate" }],
      { author: CICIRO_AUTHOR, now: () => "2026-09-25T10:00:00.000Z", newId: () => "sg-1" }
    );
    const editor = makeEditor(html);
    expect(editor.getHTML()).toBe(html);
  });

  it("finds the suggestion under the caret and its range", () => {
    const { html } = suggestReplacements('<p data-block-id="a">The cat sat.</p>', [{ find: "cat", replace: "dog" }], {
      author: CICIRO_AUTHOR,
      newId: () => "sg-9",
    });
    const editor = makeEditor(html);
    select(editor, at(5));
    expect(suggestionAt(editor.state)).toBe("sg-9");
    expect(suggestionRanges(editor.state.doc).get("sg-9")).toEqual({ from: at(4), to: at(10) });
    select(editor, at(1));
    expect(suggestionAt(editor.state)).toBeNull();
  });

  it("accepts and rejects in place without disturbing the caret elsewhere", () => {
    const { html } = suggestReplacements(
      '<p data-block-id="a">The cat sat.</p><p data-block-id="b">Mara ran home.</p>',
      [
        { find: "cat", replace: "dog" },
        { find: "ran", replace: "walked" },
      ],
      { author: CICIRO_AUTHOR }
    );
    const editor = makeEditor(html);
    const [first, second] = listSuggestions(html);
    select(editor, at(1));
    expect(resolveInEditor(editor, "accept", [second.id])).toBe(true);
    expect(editor.getHTML()).toContain("Mara walked home.");
    expect(editor.state.selection.from).toBe(at(1));
    expect(resolveInEditor(editor, "reject", [first.id])).toBe(true);
    expect(editor.getHTML()).toBe('<p data-block-id="a">The cat sat.</p><p data-block-id="b">Mara walked home.</p>');
    expect(resolveInEditor(editor, "accept")).toBe(false);
    editor.commands.undo();
    expect(editor.getHTML()).toContain("data-suggestion-id");
  });

  it("leaves typed whitespace in other paragraphs alone when resolving", () => {
    const { html } = suggestReplacements('<p data-block-id="a">The cat sat.</p><p data-block-id="b">Two  spaces.</p>', [
      { find: "cat", replace: "dog" },
    ], { author: CICIRO_AUTHOR });
    const editor = makeEditor(html, false);
    const pos = editor.state.doc.content.size - 8;
    editor.view.dispatch(editor.state.tr.insertText("  ", pos));
    const before = editor.getHTML().split("</p>")[1];
    expect(resolveInEditor(editor, "accept")).toBe(true);
    expect(editor.getHTML().split("</p>")[1]).toBe(before);
  });

  it("gives a split paragraph its own block id", () => {
    const editor = makeEditor('<p data-block-id="a">One two.</p>', false);
    select(editor, at(4));
    editor.commands.splitBlock();
    const ids = [...editor.getHTML().matchAll(/data-block-id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});
