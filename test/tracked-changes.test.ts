/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { diffHtmlToOps } from "@/lib/manuscript";
import { htmlToText } from "@/lib/text";
import { Suggestion } from "@/lib/tiptap-suggestion";
import {
  acceptSuggestions,
  rejectSuggestions,
  suggestionIdsInHtml,
  trackedDiffHtml,
  trackedInsertInlineHtml,
} from "@/lib/tracked-changes";

const ID = "sugg-1";

describe("trackedDiffHtml", () => {
  it("marks a word substitution as delete + insert sharing one id", () => {
    const html = trackedDiffHtml("The cat sat.", "The dog sat.", ID);
    expect(html).toContain(`data-suggestion="delete"`);
    expect(html).toContain(`data-suggestion="insert"`);
    expect(html).toContain(`data-suggestion-id="${ID}"`);
    expect(html).toMatch(/<span[^>]*>cat<\/span>/);
    expect(html).toMatch(/<ins[^>]*>dog<\/ins>/);
    expect(suggestionIdsInHtml(html)).toEqual([ID]);
  });

  it("marks net-new prose as a single insertion", () => {
    const html = trackedInsertInlineHtml("A new sentence.", ID);
    expect(html).toBe(
      `<ins data-suggestion="insert" data-suggestion-id="${ID}">A new sentence.</ins>`
    );
  });
});

describe("apply/reject", () => {
  it("accept keeps the insertion and drops the deletion", () => {
    const html = `<p>The ${trackedDiffHtml("cat", "dog", ID)} sat.</p>`;
    expect(acceptSuggestions(html, ID)).toBe("<p>The dog sat.</p>");
    expect(acceptSuggestions(html)).toBe("<p>The dog sat.</p>");
  });

  it("reject restores the deletion and drops the insertion", () => {
    const html = `<p>The ${trackedDiffHtml("cat", "dog", ID)} sat.</p>`;
    expect(rejectSuggestions(html, ID)).toBe("<p>The cat sat.</p>");
    expect(rejectSuggestions(html)).toBe("<p>The cat sat.</p>");
  });

  it("accept/reject of one id leaves a second hunk untouched", () => {
    const a = wrapHunk("red", "blue", "a");
    const b = wrapHunk("one", "two", "b");
    const html = `<p>${a} and ${b}</p>`;
    expect(acceptSuggestions(html, "a")).toBe(`<p>blue and ${b}</p>`);
    expect(rejectSuggestions(html, "b")).toBe(`<p>${a} and one</p>`);
    expect(acceptSuggestions(html)).toBe("<p>blue and two</p>");
    expect(rejectSuggestions(html)).toBe("<p>red and one</p>");
  });

  it("accepting net-new prose keeps it; rejecting removes it", () => {
    const html = `<p>${trackedInsertInlineHtml("Fresh line.", ID)}</p>`;
    expect(acceptSuggestions(html)).toBe("<p>Fresh line.</p>");
    expect(rejectSuggestions(html)).toBe("<p></p>");
  });
});

describe("htmlToText with pending deletions", () => {
  it("omits deleted suggestion text so word count follows the proposal", () => {
    const html = `<p>The ${trackedDiffHtml("grey cat", "black dog", ID)} sat.</p>`;
    expect(htmlToText(html)).toBe("The black dog sat.");
  });
});

describe("chapter ops round-trip", () => {
  it("diffs suggestion HTML into a replace_block so PATCH still records the edit", () => {
    const oldHtml = '<p data-block-id="b1">The cat sat.</p>';
    const newHtml = `<p data-block-id="b1">The ${trackedDiffHtml("cat", "dog", ID)} sat.</p>`;
    const ops = diffHtmlToOps(oldHtml, newHtml, 2, {
      createOpId: () => "op-1",
      actor: "user",
    });
    expect(ops).toEqual([
      {
        opId: "op-1",
        baseRevision: 2,
        actor: "user",
        type: "replace_block",
        blockId: "b1",
        html: newHtml,
      },
    ]);
  });
});

describe("TipTap suggestion commands", () => {
  function makeEditor(html: string) {
    return new Editor({
      extensions: [StarterKit, Suggestion],
      content: html,
    });
  }

  it("parses ins/span marks, then accept keeps the new word", () => {
    const editor = makeEditor(`<p>The ${trackedDiffHtml("cat", "dog", ID)} sat.</p>`);
    expect(editor.getHTML()).toContain('data-suggestion="insert"');
    expect(editor.getHTML()).toContain('data-suggestion="delete"');
    editor.commands.acceptAllSuggestions();
    expect(htmlToText(editor.getHTML())).toBe("The dog sat.");
    editor.destroy();
  });

  it("rejects a hunk and restores the original word", () => {
    const editor = makeEditor(`<p>The ${trackedDiffHtml("cat", "dog", ID)} sat.</p>`);
    editor.commands.rejectSuggestion(ID);
    expect(htmlToText(editor.getHTML())).toBe("The cat sat.");
    editor.destroy();
  });
});

function wrapHunk(oldText: string, newText: string, id: string): string {
  return trackedDiffHtml(oldText, newText, id);
}
