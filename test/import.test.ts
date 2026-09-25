import { readFileSync } from "node:fs";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { detectFormat, importFile, ImportError } from "@/lib/import";
import { parseHtml } from "@/lib/import/html";
import { parseMarkdown } from "@/lib/import/markdown";
import { parseRtf } from "@/lib/import/rtf";

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, "fixtures/import", name)));

describe("markdown import", () => {
  const result = importFile("sample.md", fixture("sample.md"));

  it("lifts a lone top heading out as the manuscript title and splits chapters on the next level", () => {
    expect(result.title).toBe("The Lighthouse Keeper");
    expect(result.chapters.map((c) => c.title)).toEqual(["Chapter One: The Storm", "Chapter Two: After"]);
  });

  it("keeps bold and italic, scene breaks and subheadings", () => {
    const [one, two] = result.chapters;
    expect(one.html).toContain("<em>hard</em>");
    expect(one.html).toContain("<strong>nobody</strong>");
    expect(one.html).toContain("<strong><em>Twelve</em></strong>");
    expect(one.html).toContain("<hr>");
    expect(one.html).toContain("<h2>The Lamp</h2>");
    expect(two.html).toContain("<blockquote><p>The sea keeps what it is given.</p></blockquote>");
  });

  it("flattens lists, escapes, code and links to plain text", () => {
    const two = result.chapters[1].html;
    expect(two).toContain("<p>• a lamp</p>");
    expect(two).toContain("<p>• a *star* chart</p>");
    expect(two).toContain("with code and a link.");
    expect(two).not.toContain("<code>");
  });

  it("reads a title from front matter and uses the file name when there are no headings", () => {
    const fm = parseMarkdown("---\ntitle: \"Salt\"\n---\n\nJust prose here.\n", "notes");
    expect(fm.title).toBe("Salt");
    expect(fm.chapters).toEqual([{ title: "notes", html: "<p>Just prose here.</p>" }]);
  });

  it("treats multiple top-level headings as chapters, not a title", () => {
    const md = parseMarkdown("# One\n\nA.\n\n# Two\n\nB.\n");
    expect(md.title).toBe("");
    expect(md.chapters.map((c) => c.title)).toEqual(["One", "Two"]);
  });

  it("keeps prose between an opening rule and a later scene break", () => {
    const md = parseMarkdown("---\n\nThe first scene.\n\n---\n\nThe second scene.\n", "notes");
    expect(md.title).toBe("");
    expect(md.chapters[0].html).toBe("<p>The first scene.</p><hr><p>The second scene.</p>");
  });

  it("does not turn a scene break after a blank line into a setext heading", () => {
    const md = parseMarkdown("# One\n\nA line.\n\n---\n\nAnother.\n");
    expect(md.chapters[0].html).toBe("<p>A line.</p><hr><p>Another.</p>");
  });
});

describe("docx import", () => {
  const result = importFile("sample.docx", fixture("sample.docx"));

  it("uses the Title style as the manuscript title and Heading 1 as chapters", () => {
    expect(result.title).toBe("The Lighthouse Keeper");
    expect(result.chapters.map((c) => c.title)).toEqual(["Chapter One", "Chapter Two"]);
  });

  it("preserves bold, italic, scene breaks and subheadings", () => {
    expect(result.chapters[0].html).toBe(
      "<p>The wind came in <em>hard</em> off the water, and <strong>nobody</strong> slept.</p>" +
        "<hr><p>By morning the harbor was quiet.</p><h2>The Lamp</h2><p>She climbed the stairs.</p>"
    );
  });

  it("ignores tracked deletions", () => {
    expect(result.chapters[1].html).toBe("<p>Rain on the glass, still falling.</p>");
  });

  it("refuses an archive that inflates past the size limit", () => {
    const bomb = zipSync({ "word/document.xml": new Uint8Array(201 * 1024 * 1024) }, { level: 1 });
    expect(() => importFile("bomb.docx", bomb)).toThrow(/too large to import/);
  });

  it("rejects a zip that is not a Word document", () => {
    expect(() => importFile("bad.docx", fixture("sample.scriv.zip"))).toThrow(ImportError);
    expect(() => importFile("bad.docx", new Uint8Array([1, 2, 3]))).toThrow(/not a valid \.docx/);
  });
});

describe("Google Docs HTML import", () => {
  const result = importFile("google-docs.html", fixture("google-docs.html"));

  it("honours span weight and style over the font-weight:normal wrapper", () => {
    expect(result.title).toBe("Salt & Iron");
    expect(result.chapters.map((c) => c.title)).toEqual(["Chapter 1", "Chapter 2"]);
    expect(result.chapters[0].html).toBe(
      "<p>She opened the door and <strong>screamed</strong>, then <em>laughed</em>.</p><hr><p>The road ran on.</p>"
    );
  });

  it("flattens lists", () => {
    expect(result.chapters[1].html).toBe("<p>Nothing happened here.</p><p>• one</p><p>• two</p>");
  });
});

describe("HTML lists", () => {
  it("keeps the marker on items whose text sits in a paragraph", () => {
    const html = parseHtml(
      '<p>Intro.</p><ul><li><p role="presentation"><span>one</span></p></li><li><p>two</p></li></ul>' +
        "<ol><li><p>first</p></li></ol>"
    );
    expect(html.chapters[0].html).toBe("<p>Intro.</p><p>• one</p><p>• two</p><p>1. first</p>");
  });
});

describe("scrivener import", () => {
  const result = importFile("sample.scriv.zip", fixture("sample.scriv.zip"));

  it("follows binder order inside the Draft folder only", () => {
    expect(result.title).toBe("Lighthouse");
    expect(result.chapters.map((c) => c.title)).toEqual(["The Storm", "Aftermath"]);
  });

  it("joins a chapter folder's documents as scenes and keeps RTF formatting", () => {
    expect(result.chapters[0].html).toBe(
      "<p>The wind came in <em>hard</em> off the water.</p><p><strong>nobody</strong> slept, and café lights burned.</p>" +
        "<hr><p>Night fell over the “harbor”.</p>"
    );
    expect(result.chapters[1].html).toBe("<p>By morning it was quiet.</p>");
  });

  it("keeps every paragraph of a document that contains chapter-like lines", () => {
    const scrivx =
      '<?xml version="1.0"?><ScrivenerProject><Binder>' +
      '<BinderItem UUID="A" Type="DraftFolder"><Title>Draft</Title><Children>' +
      '<BinderItem UUID="B" Type="Text"><Title>Opening</Title></BinderItem>' +
      "</Children></BinderItem></Binder></ScrivenerProject>";
    const zip = zipSync({
      "Book.scriv/Book.scrivx": strToU8(scrivx),
      "Book.scriv/Files/Data/B/content.rtf": strToU8(
        "{\\rtf1\\pard Dear reader.\\par Chapter 1\\par Text A\\par Chapter 2\\par Text B\\par}"
      ),
    });
    const book = importFile("Book.scriv.zip", zip);
    expect(book.chapters).toEqual([
      {
        title: "Opening",
        html: "<p>Dear reader.</p><p>Chapter 1</p><p>Text A</p><p>Chapter 2</p><p>Text B</p>",
      },
    ]);
  });

  it("explains a zip that holds no project", () => {
    expect(() => importFile("x.zip", fixture("sample.docx"))).toThrow(/No Scrivener project/);
  });
});

describe("rtf reader", () => {
  it("skips font tables and unicode fallbacks", () => {
    const blocks = parseRtf("{\\rtf1{\\fonttbl{\\f0 Arial;}}\\pard Caf\\u233? \\b bold\\b0 \\par Two\\par}");
    expect(blocks.map((b) => (b.kind === "paragraph" ? b.html : b.kind))).toEqual(["Café <strong>bold</strong>", "Two"]);
  });
});

describe("format detection", () => {
  it("maps extensions and rejects unknown ones", () => {
    expect(detectFormat("A.DOCX")).toBe("docx");
    expect(detectFormat("a.markdown")).toBe("markdown");
    expect(detectFormat("book.scriv.zip")).toBe("scrivener");
    expect(() => importFile("a.pdf", new Uint8Array())).toThrow(/Unsupported/);
    expect(() => importFile("a.md", new TextEncoder().encode("  \n"))).toThrow(/no text/);
  });
});
