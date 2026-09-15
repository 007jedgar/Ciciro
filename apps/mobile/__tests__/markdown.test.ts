import { blockText, parseInline, parseMarkdown } from "../lib/markdown";

describe("parseInline", () => {
  it("reads bold, italic, strikethrough, and inline code", () => {
    expect(parseInline("a **b** c *d* e ~~f~~ g `h`")).toEqual([
      { text: "a " },
      { text: "b", bold: true },
      { text: " c " },
      { text: "d", italic: true },
      { text: " e " },
      { text: "f", strike: true },
      { text: " g " },
      { text: "h", code: true },
    ]);
  });

  it("reads the combined triple marker as both", () => {
    expect(parseInline("***both***")).toEqual([{ text: "both", bold: true, italic: true }]);
  });

  it("keeps every character when emphasis nests in a way it cannot pair up", () => {
    // The parser is deliberately simple; the contract is that prose survives it.
    expect(parseInline("**bold and *both***").map((span) => span.text).join("")).toBe(
      "bold and *both*"
    );
  });

  it("keeps markers literal inside code, where they carry no formatting", () => {
    expect(parseInline("`a **b** c`")).toEqual([{ text: "a **b** c", code: true }]);
  });

  it("carries a link's href and falls back to the url when the label is empty", () => {
    expect(parseInline("see [the note](https://x.test/n)")).toEqual([
      { text: "see " },
      { text: "the note", href: "https://x.test/n" },
    ]);
    expect(parseInline("[](https://x.test)")).toEqual([
      { text: "https://x.test", href: "https://x.test" },
    ]);
  });

  it("leaves mid-word underscores and asterisks alone", () => {
    expect(parseInline("snake_case_name and 2*3*4")).toEqual([
      { text: "snake_case_name and 2*3*4" },
    ]);
  });
});

describe("parseMarkdown", () => {
  it("splits headings, lists, quotes, rules, and paragraphs", () => {
    const blocks = parseMarkdown(
      [
        "## Chapter notes",
        "",
        "The scene runs long.",
        "It still lands.",
        "",
        "- trim the opening",
        "2. move the reveal",
        "",
        "> she never said it aloud",
        "",
        "---",
      ].join("\n")
    );
    expect(blocks.map((block) => block.kind)).toEqual([
      "heading",
      "paragraph",
      "listItem",
      "listItem",
      "quote",
      "rule",
    ]);
    expect(blocks[0]).toMatchObject({ level: 2 });
    // Soft-wrapped lines join into one paragraph, as markdown specifies.
    expect(blockText(blocks[1]!)).toBe("The scene runs long. It still lands.");
    expect(blocks[3]).toMatchObject({ ordered: true, marker: "2." });
  });

  it("keeps fenced code verbatim, markers and all", () => {
    const blocks = parseMarkdown("Try:\n\n```ts\nconst a = **1**;\n```\n");
    expect(blocks[1]).toEqual({ kind: "code", text: "const a = **1**;", language: "ts" });
  });

  it("treats an unterminated fence as code, since a stream ends mid-block", () => {
    expect(parseMarkdown("```\nhalf a line")).toEqual([
      { kind: "code", text: "half a line", language: "" },
    ]);
  });

  it("returns nothing for empty or whitespace-only replies", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown("\n \n")).toEqual([]);
  });
});
