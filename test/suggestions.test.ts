import { describe, expect, it } from "vitest";
import {
  CICIRO_AUTHOR,
  carrySuggestions,
  hasSuggestions,
  htmlWithoutSuggestions,
  listSuggestions,
  resolveSuggestions,
  suggestReplacements,
  suggestionsAsDisplayMarks,
  type SuggestionAuthor,
} from "@/lib/suggestions";
import { chapterWordCount } from "@/lib/text";

const AT = "2026-09-25T10:00:00.000Z";
const AUTHOR: SuggestionAuthor = { authorId: "user-1", authorName: "Mara Quill" };

function ins(id: string, text: string, who: SuggestionAuthor = CICIRO_AUTHOR): string {
  return `<ins data-suggestion-id="${id}" data-author-id="${who.authorId}" data-author-name="${who.authorName}" data-created-at="${AT}">${text}</ins>`;
}

function del(id: string, text: string, who: SuggestionAuthor = CICIRO_AUTHOR): string {
  return `<del data-suggestion-id="${id}" data-author-id="${who.authorId}" data-author-name="${who.authorName}" data-created-at="${AT}">${text}</del>`;
}

function ids() {
  let n = 0;
  return () => `sg-${++n}`;
}

function suggest(html: string, edits: { find: string; replace: string }[], author = CICIRO_AUTHOR) {
  let block = 0;
  return suggestReplacements(html, edits, {
    author,
    now: () => AT,
    newId: ids(),
    newBlockId: () => `nb${++block}`,
  });
}

describe("reading suggestions", () => {
  const html =
    `<p data-block-id="a">She ${del("s1", "walked slowly")}${ins("s1", "ambled")} to the door.</p>` +
    `<p data-block-id="b">Plain paragraph.</p>` +
    `<p data-block-id="c">${ins("s2", "A new line.", AUTHOR)}</p>`;

  it("detects pending marks and ignores plain ins/del", () => {
    expect(hasSuggestions(html)).toBe(true);
    expect(hasSuggestions("<p>Old <del>struck</del> <ins>added</ins></p>")).toBe(false);
  });

  it("lists every suggestion in document order with a preview", () => {
    const list = listSuggestions(html);
    expect(list.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(list[0]).toMatchObject({
      authorId: "ciciro",
      authorName: "Ciciro",
      createdAt: AT,
      blockIds: ["a"],
      deleted: "walked slowly",
      inserted: "ambled",
    });
    expect(list[0].preview).toEqual([
      { kind: "context", text: "She " },
      { kind: "delete", text: "walked slowly" },
      { kind: "insert", text: "ambled" },
      { kind: "context", text: " to the door." },
    ]);
    expect(list[1]).toMatchObject({ authorName: "Mara Quill", inserted: "A new line.", deleted: "" });
  });

  it("keeps long context short and marked as cut", () => {
    const long = "word ".repeat(40);
    const [summary] = listSuggestions(`<p data-block-id="x">${long}${ins("s", "new")} ${long}</p>`);
    const [before, , after] = summary.preview;
    expect(before.text.startsWith("…")).toBe(true);
    expect(before.text.length).toBeLessThanOrEqual(50);
    expect(after.text.endsWith("…")).toBe(true);
  });
});

describe("resolving suggestions", () => {
  const html =
    `<p data-block-id="a">She ${del("s1", "walked <em>slowly</em>")}${ins("s1", "ambled")} to the door.</p>` +
    `<p data-block-id="b">Untouched &amp; plain.</p>` +
    `<p data-block-id="c">${del("s2", "A whole paragraph to cut.")}</p>` +
    `<p data-block-id="d">${ins("s3", "A whole paragraph to add.")}</p>`;

  it("accepts one suggestion and leaves the rest byte-for-byte", () => {
    const next = resolveSuggestions(html, "accept", ["s1"]);
    expect(next).toBe(
      `<p data-block-id="a">She ambled to the door.</p>` +
        `<p data-block-id="b">Untouched &amp; plain.</p>` +
        `<p data-block-id="c">${del("s2", "A whole paragraph to cut.")}</p>` +
        `<p data-block-id="d">${ins("s3", "A whole paragraph to add.")}</p>`
    );
  });

  it("rejects one suggestion, restoring the old words with their formatting", () => {
    const next = resolveSuggestions(html, "reject", ["s1"]);
    expect(next.startsWith(`<p data-block-id="a">She walked <em>slowly</em> to the door.</p>`)).toBe(true);
  });

  it("drops a paragraph whose words were all removed", () => {
    expect(resolveSuggestions(html, "accept")).toBe(
      `<p data-block-id="a">She ambled to the door.</p>` +
        `<p data-block-id="b">Untouched &amp; plain.</p>` +
        `<p data-block-id="d">A whole paragraph to add.</p>`
    );
    expect(resolveSuggestions(html, "reject")).toBe(
      `<p data-block-id="a">She walked <em>slowly</em> to the door.</p>` +
        `<p data-block-id="b">Untouched &amp; plain.</p>` +
        `<p data-block-id="c">A whole paragraph to cut.</p>`
    );
  });

  it("keeps one empty paragraph rather than an empty chapter", () => {
    expect(resolveSuggestions(`<p data-block-id="z">${ins("s", "Only line.")}</p>`, "reject")).toBe(
      `<p data-block-id="z"></p>`
    );
  });

  it("returns the input untouched when nothing is pending", () => {
    const plain = "<p data-block-id=\"a\">Nothing <strong>here</strong>.</p><hr data-block-id=\"h\">";
    expect(resolveSuggestions(plain, "accept")).toBe(plain);
    expect(resolveSuggestions(html, "accept", ["missing"])).toBe(html);
  });

  it("treats pending suggestions as not yet applied for word counts", () => {
    expect(htmlWithoutSuggestions(html)).toBe(resolveSuggestions(html, "reject"));
    // She walked slowly to the door. / Untouched & plain. / A whole paragraph to cut.
    expect(chapterWordCount(html)).toBe(6 + 3 + 5);
  });

  it("handles suggestions inside nested quote paragraphs", () => {
    const quote = `<blockquote data-block-id="q"><p>Keep ${del("s", "this")}${ins("s", "that")}.</p></blockquote>`;
    expect(resolveSuggestions(quote, "accept")).toBe(`<blockquote data-block-id="q"><p>Keep that.</p></blockquote>`);
    expect(resolveSuggestions(`<blockquote data-block-id="q"><p>${ins("s", "All new.")}</p></blockquote><p>x</p>`, "reject")).toBe(
      "<p>x</p>"
    );
  });
});

describe("proposing edits as suggestions", () => {
  it("marks only the words that changed", () => {
    const { html, outcomes } = suggest(`<p data-block-id="a">She walked slowly to the door.</p>`, [
      { find: "She walked slowly to the door.", replace: "She ambled to the door." },
    ]);
    expect(outcomes).toEqual([{ status: "suggested", count: 1, conflicts: 0 }]);
    expect(html).toBe(`<p data-block-id="a">She ${del("sg-1", "walked slowly")}${ins("sg-1", "ambled")} to the door.</p>`);
    expect(resolveSuggestions(html, "accept")).toBe(`<p data-block-id="a">She ambled to the door.</p>`);
    expect(resolveSuggestions(html, "reject")).toBe(`<p data-block-id="a">She walked slowly to the door.</p>`);
  });

  it("matches across whitespace differences and inline formatting", () => {
    const source = `<p data-block-id="a">The <em>old</em>   man  waited.</p>`;
    const { html } = suggest(source, [{ find: "The old man\nwaited.", replace: "The old man slept." }]);
    expect(resolveSuggestions(html, "accept")).toBe(`<p data-block-id="a">The <em>old</em>   man  slept.</p>`);
    expect(resolveSuggestions(html, "reject")).toBe(source);
  });

  it("gives every occurrence its own suggestion", () => {
    const { html, outcomes } = suggest(`<p data-block-id="a">Mara ran.</p><p data-block-id="b">Then Mara slept.</p>`, [
      { find: "Mara", replace: "Marta" },
    ]);
    expect(outcomes[0]).toMatchObject({ status: "suggested", count: 2 });
    expect(listSuggestions(html).map((s) => [s.deleted, s.inserted])).toEqual([
      ["Mara", "Marta"],
      ["Mara", "Marta"],
    ]);
    const [first] = listSuggestions(html);
    expect(resolveSuggestions(html, "accept", [first.id])).toContain("Marta ran.");
    expect(resolveSuggestions(html, "accept", [first.id])).toContain("Mara");
  });

  it("reports text it could not find or would not change", () => {
    const source = `<p data-block-id="a">Nothing to see.</p>`;
    const { html, outcomes } = suggest(source, [
      { find: "missing words", replace: "x" },
      { find: "Nothing", replace: "Nothing" },
    ]);
    expect(html).toBe(source);
    expect(outcomes).toEqual([{ status: "not_found" }, { status: "unchanged" }]);
  });

  it("leaves text under someone else's pending suggestion alone", () => {
    const source = `<p data-block-id="a">The ${del("u1", "cat", AUTHOR)}${ins("u1", "dog", AUTHOR)} sat.</p>`;
    const { html, outcomes } = suggest(source, [{ find: "The cat sat.", replace: "The bird sat." }]);
    expect(html).toBe(source);
    expect(outcomes).toEqual([{ status: "conflict", authorName: "Mara Quill" }]);
  });

  it("reworks its own pending suggestion instead of stacking a second one", () => {
    const pending = `<p data-block-id="a">She ${del("old", "walked")}${ins("old", "strolled")} home.</p>`;
    // Quoting the new wording.
    const byNew = suggest(pending, [{ find: "strolled", replace: "ambled" }]);
    expect(byNew.html).toBe(`<p data-block-id="a">She ${del("sg-1", "walked")}${ins("sg-1", "ambled")} home.</p>`);
    // Quoting the old wording.
    const byOld = suggest(pending, [{ find: "walked home", replace: "ran home" }]);
    expect(byOld.html).toBe(`<p data-block-id="a">She ${del("sg-1", "walked")}${ins("sg-1", "ran")} home.</p>`);
  });

  it("pairs whole paragraphs and marks spare ones", () => {
    const source = `<p data-block-id="a">First one.</p><p data-block-id="b">Second one.</p><p data-block-id="c">Third.</p>`;
    const merged = suggest(source, [{ find: "First one.\n\nSecond one.", replace: "Only one." }]);
    expect(merged.outcomes[0]).toMatchObject({ status: "suggested", count: 1 });
    expect(resolveSuggestions(merged.html, "accept")).toBe(`<p data-block-id="a">Only one.</p><p data-block-id="c">Third.</p>`);
    expect(resolveSuggestions(merged.html, "reject")).toBe(source);

    const split = suggest(source, [{ find: "First one. Second one.", replace: "One.\n\nTwo.\n\nThree." }]);
    expect(resolveSuggestions(split.html, "accept")).toBe(
      `<p data-block-id="a">One.</p><p data-block-id="b">Two.</p><p data-block-id="nb1">Three.</p><p data-block-id="c">Third.</p>`
    );
    expect(resolveSuggestions(split.html, "reject")).toBe(source);
    expect(new Set(listSuggestions(split.html).map((s) => s.id)).size).toBe(1);
  });

  it("escapes author names and keeps entities intact", () => {
    const { html } = suggest(`<p data-block-id="a">Tom &amp; Jerry &lt;3</p>`, [{ find: "Jerry", replace: "Spike" }], {
      authorId: "u",
      authorName: 'Ann "Quill" & Co',
    });
    expect(html).toContain('data-author-name="Ann &quot;Quill&quot; &amp; Co"');
    expect(listSuggestions(html)[0].authorName).toBe('Ann "Quill" & Co');
    expect(resolveSuggestions(html, "accept")).toBe(`<p data-block-id="a">Tom &amp; Spike &lt;3</p>`);
  });
});

describe("plain-editor round trip (the phone)", () => {
  const base = `<p data-block-id="a">She ${del("s1", "walked")}${ins("s1", "ambled")} home.</p><p data-block-id="b">Next <strong>bold</strong> line.</p>`;

  it("shows suggestions as underline and strikethrough", () => {
    expect(suggestionsAsDisplayMarks(base)).toBe(
      `<p data-block-id="a">She <s>walked</s><u>ambled</u> home.</p><p data-block-id="b">Next <strong>bold</strong> line.</p>`
    );
  });

  it("gives back the exact previous HTML when nothing was edited", () => {
    expect(carrySuggestions(base, suggestionsAsDisplayMarks(base))).toBe(base);
  });

  it("carries marks across edits elsewhere and keeps real formatting", () => {
    const edited = `<p data-block-id="a">So she <s>walked</s><u>ambled</u> home.</p><p data-block-id="b">Next <strong>bold</strong> line!</p>`;
    expect(carrySuggestions(base, edited)).toBe(
      `<p data-block-id="a">So she ${del("s1", "walked")}${ins("s1", "ambled")} home.</p><p data-block-id="b">Next <strong>bold</strong> line!</p>`
    );
  });

  it("lets typing inside an insertion join it", () => {
    const edited = `<p data-block-id="a">She <s>walked</s><u>amXbled</u> home.</p><p data-block-id="b">Next <strong>bold</strong> line.</p>`;
    expect(carrySuggestions(base, edited)).toContain(ins("s1", "amXbled"));
  });

  it("does not let text typed after a suggestion inherit its display mark", () => {
    const afterIns = `<p data-block-id="a">She <s>walked</s><u>ambled far</u> home.</p><p data-block-id="b">Next <strong>bold</strong> line.</p>`;
    expect(carrySuggestions(base, afterIns)).toContain(`${ins("s1", "ambled")} far home.`);
    const afterDel = `<p data-block-id="a">She <s>walked, </s><u>ambled</u> home.</p><p data-block-id="b">Next <strong>bold</strong> line.</p>`;
    const carried = carrySuggestions(base, afterDel);
    expect(carried).toContain(`${del("s1", "walked")}, ${ins("s1", "ambled")}`);
  });

  it("keeps marks when paragraphs are joined", () => {
    const joined = `<p data-block-id="a">She <s>walked</s><u>ambled</u> home.Next <strong>bold</strong> line.</p>`;
    expect(carrySuggestions(base, joined)).toBe(
      `<p data-block-id="a">She ${del("s1", "walked")}${ins("s1", "ambled")} home.Next <strong>bold</strong> line.</p>`
    );
  });

  it("is a no-op when the previous document had no suggestions", () => {
    const html = "<p>Just <u>underlined</u>.</p>";
    expect(carrySuggestions("<p>Before.</p>", html)).toBe(html);
  });
});
