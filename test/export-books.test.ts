import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { htmlToBlocks } from "@/lib/export/blocks";
import { buildEpub } from "@/lib/export/epub";
import { buildPdf } from "@/lib/export/pdf";
import { buildMarkdown, buildChapterMarkdown } from "@/lib/export/markdown";
import { bookFilename } from "@/lib/export/types";

const project = {
  id: "proj1",
  title: "The Salt & Sea",
  author: "Ada Quill",
  genre: "Literary fiction",
  chapters: [
    { title: "Second", order: 1, content: "<p>Later <em>on</em>.</p>" },
    {
      title: "First",
      order: 0,
      content:
        "<p>She said <strong>hello</strong> &amp; left.</p><hr><p>* * *</p><blockquote><p>Quoted</p></blockquote><ul><li><p>one</p></li><li><p>two</p></li></ul><h2>Part</h2>",
    },
    { title: "", order: 2, content: "" },
  ],
};

describe("htmlToBlocks", () => {
  it("keeps structure and inline emphasis", () => {
    const blocks = htmlToBlocks(project.chapters[1].content);
    expect(blocks.map((b) => b.type)).toEqual([
      "paragraph",
      "break",
      "break",
      "quote",
      "list-item",
      "list-item",
      "heading",
    ]);
    const p = blocks[0];
    expect(p.type === "paragraph" && p.runs).toEqual([
      { text: "She said " },
      { text: "hello", bold: true },
      { text: " & left." },
    ]);
  });

  it("numbers ordered lists and decodes entities", () => {
    const blocks = htmlToBlocks("<ol><li>a &#8212; b</li><li>c</li></ol>");
    expect(blocks.map((b) => (b.type === "list-item" ? b.marker : ""))).toEqual(["1.", "2."]);
    expect(blocks[0].type === "list-item" && blocks[0].runs[0].text).toBe("a — b");
  });

  it("returns nothing for empty content", () => {
    expect(htmlToBlocks("")).toEqual([]);
    expect(htmlToBlocks("<p></p>")).toEqual([]);
  });
});

describe("buildEpub", () => {
  it("produces a valid package with title page, contents and ordered chapters", async () => {
    const bytes = await buildEpub(project, new Date("2026-01-02T03:04:05Z"));
    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files);
    expect(names[0]).toBe("mimetype");
    expect(await zip.file("mimetype")!.async("string")).toBe("application/epub+zip");

    const opf = await zip.file("OEBPS/content.opf")!.async("string");
    expect(opf).toContain("<dc:title>The Salt &amp; Sea</dc:title>");
    expect(opf).toContain("<dc:creator>Ada Quill</dc:creator>");
    expect(opf).toContain("2026-01-02T03:04:05Z");
    const spine = [...opf.matchAll(/<itemref idref="([^"]+)"/g)].map((m) => m[1]);
    expect(spine).toEqual(["title", "nav", "chapter-1", "chapter-2", "chapter-3"]);

    const nav = await zip.file("OEBPS/nav.xhtml")!.async("string");
    expect(nav.indexOf("First")).toBeLessThan(nav.indexOf("Second"));
    expect(nav).toContain("Chapter 3");

    const ch1 = await zip.file("OEBPS/chapter-001.xhtml")!.async("string");
    expect(ch1).toContain("<h1 class=\"chapter-title\">First</h1>");
    expect(ch1).toContain("<strong>hello</strong> &amp; left.");
    expect(ch1).toContain("<blockquote>");
    expect(ch1).toContain("<ul><li>one</li><li>two</li></ul>");
    expect(await zip.file("OEBPS/chapter-003.xhtml")!.async("string")).toContain("This chapter is empty.");
    expect(await zip.file("OEBPS/title.xhtml")!.async("string")).toContain("Ada Quill");
  });

  it("keeps adjacent lists apart with their own type and numbering", async () => {
    const bytes = await buildEpub({
      title: "Lists",
      author: "A",
      chapters: [
        {
          title: "One",
          order: 0,
          content:
            "<ul><li>a</li></ul><ol><li>b</li><li>c</li></ol><ol><li>d</li><li><p>e</p><ul><li>f</li></ul></li><li>g</li></ol>",
        },
      ],
    });
    const zip = await JSZip.loadAsync(bytes);
    const ch = await zip.file("OEBPS/chapter-001.xhtml")!.async("string");
    expect(ch).toContain(
      [
        "<ul><li>a</li></ul>",
        "<ol><li>b</li><li>c</li></ol>",
        "<ol><li>d</li><li>e</li></ol>",
        "<ul><li>f</li></ul>",
        '<ol start="3"><li>g</li></ol>',
      ].join("\n")
    );
  });
});

describe("buildPdf", () => {
  it("lays out title page, contents and chapters with metadata", async () => {
    const bytes = await buildPdf(project, new Date("2026-01-02T03:04:05Z"));
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getTitle()).toBe("The Salt & Sea");
    expect(doc.getAuthor()).toBe("Ada Quill");
    // title + contents + one page per chapter
    expect(doc.getPageCount()).toBe(5);
    const { width, height } = doc.getPage(0).getSize();
    expect([width, height]).toEqual([432, 648]);
  });

  it("flows long chapters over many pages and survives unsupported text", async () => {
    const para = `<p>${"Lorem ipsum dolor sit amet, consectetur. ".repeat(40)}</p>`;
    const bytes = await buildPdf({
      title: "日本語のタイトル",
      author: "",
      chapters: [
        { title: "Ünïcödé ✓ 😀", order: 0, content: para.repeat(30) + `<p>${"x".repeat(400)}</p>` },
      ],
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(10);
  });

  it("paginates a long contents list", async () => {
    const chapters = Array.from({ length: 60 }, (_, i) => ({
      title: `Chapter number ${i + 1}`,
      order: i,
      content: "<p>Text.</p>",
    }));
    const doc = await PDFDocument.load(await buildPdf({ title: "T", author: "A", chapters }));
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1 + 3 + 60);
  });
});

describe("buildMarkdown", () => {
  it("produces valid markdown with title, author, and ordered chapters", () => {
    const md = buildMarkdown(project);
    expect(md).toContain("# The Salt & Sea");
    expect(md).toContain("**By Ada Quill**");
    const firstIdx = md.indexOf("## First");
    const secondIdx = md.indexOf("## Second");
    expect(firstIdx).toBeLessThan(secondIdx);
    expect(md).toContain("**hello**");
    expect(md).toContain("*on*");
    expect(md).toContain("> Quoted");
  });

  it("preserves inline formatting in markdown", () => {
    const md = buildMarkdown(project);
    expect(md).toContain("She said **hello** & left.");
    expect(md).toContain("Later *on*.");
  });

  it("marks empty chapters as empty", () => {
    const md = buildMarkdown(project);
    expect(md).toContain("## Chapter 3");
    expect(md).toContain("*This chapter is empty.*");
  });

  it("includes lists and scene breaks", () => {
    const md = buildMarkdown(project);
    expect(md).toContain("- one");
    expect(md).toContain("- two");
    expect(md).toContain("---");
  });

  it("converts headings with correct markdown syntax", () => {
    const md = buildMarkdown({
      title: "Test",
      author: "A",
      chapters: [
        {
          title: "Chapter One",
          order: 0,
          content: "<h2>Part One</h2><p>Text</p><h3>Section</h3>",
        },
      ],
    });
    expect(md).toContain("## Chapter One");
    expect(md).toContain("### Part One");
    expect(md).toContain("#### Section");
  });
});

describe("buildChapterMarkdown", () => {
  it("exports a single chapter", () => {
    const md = buildChapterMarkdown(project.chapters[1], 0);
    expect(md).toContain("## First");
    expect(md).toContain("She said **hello** & left.");
    expect(md).toContain("> Quoted");
    expect(md).toContain("- one");
  });
});

describe("bookFilename", () => {
  it("slugs titles and falls back", () => {
    expect(bookFilename("The Salt & Sea!", "epub")).toBe("the_salt_sea.epub");
    expect(bookFilename("", "pdf")).toBe("manuscript.pdf");
    expect(bookFilename("My Book", "md")).toBe("my_book.md");
  });
});
