// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { BlockId } from "@/lib/tiptap-block-id";
import { FLASH_MS, FlashHighlight, flashRanges } from "@/lib/tiptap-flash";
import {
  SuggestionDeletion,
  SuggestionInsertion,
  TrackChanges,
  resolveInEditor,
  resolvedRanges,
} from "@/lib/tiptap-suggestions";

const attrs = (id: string) =>
  `data-suggestion-id="${id}" data-author-id="ciciro" data-author-name="Ciciro" data-created-at="2026-09-25T10:00:00.000Z"`;
const HTML =
  `<p data-block-id="b1">She <del ${attrs("a")}>walked slowly</del><ins ${attrs("a")}>ambled</ins> to the ford ` +
  `and <del ${attrs("b")}>was afraid</del><ins ${attrs("b")}>felt dread</ins> of it.</p>`;

const editors: Editor[] = [];
function makeEditor(content = HTML): Editor {
  const editor = new Editor({
    extensions: [StarterKit, BlockId, SuggestionInsertion, SuggestionDeletion, TrackChanges, FlashHighlight],
    content,
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  vi.useRealTimers();
  while (editors.length) editors.pop()?.destroy();
});

const flashed = (editor: Editor) =>
  Array.from(editor.view.dom.querySelectorAll("[class^='flash-']")).map((el) => el.textContent);

describe("resolvedRanges", () => {
  it("accepting keeps the inserted text, at its place once the deletions are gone", () => {
    const editor = makeEditor();
    const ranges = resolvedRanges(editor.state.doc, "accept");
    expect(ranges.map((r) => r.text)).toEqual(["ambled", "felt dread"]);
    resolveInEditor(editor, "accept");
    for (const r of ranges) {
      expect(editor.state.doc.textBetween(r.from, r.to)).toBe(r.text);
    }
  });

  it("rejecting keeps the deleted text", () => {
    const editor = makeEditor();
    const ranges = resolvedRanges(editor.state.doc, "reject");
    expect(ranges.map((r) => r.text)).toEqual(["walked slowly", "was afraid"]);
    resolveInEditor(editor, "reject");
    for (const r of ranges) {
      expect(editor.state.doc.textBetween(r.from, r.to)).toBe(r.text);
    }
  });

  it("only follows the ids it is given", () => {
    const editor = makeEditor();
    const ranges = resolvedRanges(editor.state.doc, "accept", ["b"]);
    expect(ranges.map((r) => r.text)).toEqual(["felt dread"]);
    resolveInEditor(editor, "accept", ["b"]);
    expect(editor.state.doc.textBetween(ranges[0].from, ranges[0].to)).toBe("felt dread");
  });
});

describe("flashRanges", () => {
  it("marks the range, then removes the mark when its animation is over", () => {
    vi.useFakeTimers();
    const editor = makeEditor("<p>Hello brave world</p>");
    flashRanges(editor, [{ from: 7, to: 12 }], "pulse");
    expect(flashed(editor)).toEqual(["brave"]);
    expect(editor.view.dom.querySelector(".flash-pulse")).not.toBeNull();
    vi.advanceTimersByTime(FLASH_MS.pulse + 1);
    expect(flashed(editor)).toEqual([]);
  });

  it("never reaches the saved HTML", () => {
    const editor = makeEditor("<p>Hello brave world</p>");
    const before = editor.getHTML();
    flashRanges(editor, [{ from: 7, to: 12 }], "accept");
    expect(editor.getHTML()).toBe(before);
    expect(editor.getHTML()).not.toContain("flash");
  });

  it("clamps a range that has run past the end of the page", () => {
    vi.useFakeTimers();
    const editor = makeEditor("<p>Short</p>");
    expect(() => flashRanges(editor, [{ from: 3, to: 999 }], "reject")).not.toThrow();
    expect(flashed(editor)).toEqual(["ort"]);
  });
});
