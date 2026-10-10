import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { UnsupportedScriptError, buildScreenplayPdf, screenplayPdfSupported } from "@/lib/export/screenplay-pdf";
import { scriptBlocksToHtml } from "@/lib/fountain";
import { estimatePages, pagesAsText, typesetSequences, type ScriptBlock } from "@/lib/screenplay";
import { NIGHT_SHIFT } from "./fixtures/screenplay/night-shift";
import { longScript } from "./fixtures/screenplay/long-script";

const PAGE_H = 792;

type Placed = { x: number; y: number; text: string };

/** What each page draws: every text-showing operator with where it sits. */
async function drawn(bytes: Uint8Array): Promise<Placed[][]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => doc.context.lookup(ref)) : [contents];
    const text = streams
      .map((s) => (s instanceof PDFRawStream ? new TextDecoder("latin1").decode(decodePDFRawStream(s).decode()) : ""))
      .join("\n");
    return [...text.matchAll(/1 0 0 1 ([\d.-]+) ([\d.-]+) Tm\s*<([0-9A-F]*)> Tj/g)].map((m) => ({
      x: Number(m[1]),
      y: Number(m[2]),
      text: m[3].replace(/../g, (h) => String.fromCharCode(parseInt(h, 16))),
    }));
  });
}

/** The page as text the way `pagesAsText` sets it: column by column, row by row; the number apart. */
function asText(placed: Placed[]): { number: string; text: string } {
  const body = placed.filter((p) => p.y < PAGE_H - 72);
  const rows: string[] = [];
  for (const p of body) {
    const r = Math.round((PAGE_H - 72 - 9.6 - p.y) / 12);
    const col = Math.round((p.x - 108) / 7.2);
    const line = (rows[r] ?? "").padEnd(col) + p.text;
    rows[r] = line;
  }
  return {
    number: placed.filter((p) => p.y >= PAGE_H - 72).map((p) => p.text).join(""),
    text: Array.from(rows, (r) => r ?? "").join("\n"),
  };
}

const html = (blocks: ScriptBlock[]) => scriptBlocksToHtml(blocks.map((b) => ({ element: b.element, runs: [{ text: b.text }] })));
const book = (...chapters: string[]) => ({
  title: "Night Shift",
  author: "A. Writer",
  chapters: chapters.map((content, order) => ({ title: `Sequence ${order + 1}`, content, order })),
});

describe("screenplay PDF", () => {
  it("is US Letter, and draws the same pages the engine sets", async () => {
    const bytes = await buildScreenplayPdf(book(html(NIGHT_SHIFT)));
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
    const want = pagesAsText(typesetSequences([NIGHT_SHIFT]).pages);
    const got = (await drawn(bytes)).map(asText);
    expect(got.map((p) => p.text)).toEqual(want);
  });

  it("numbers every page but the first, top right", async () => {
    const bytes = await buildScreenplayPdf(book(html(NIGHT_SHIFT)));
    const pages = await drawn(bytes);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.map((p) => asText(p).number)).toEqual(pages.map((_, i) => (i === 0 ? "" : `${i + 1}.`)));
    const number = pages[1].find((p) => p.text === "2.")!;
    expect(number.x + 2 * 7.2).toBeCloseTo(540, 5);
    expect(number.y).toBeGreaterThan(PAGE_H - 72);
  });

  it("has as many pages as the editor counts, whatever the script", async () => {
    for (const pages of [1, 7, 30, 61]) {
      const sequences = longScript(pages).map((s) => scriptBlocksToHtml(s.blocks));
      const bytes = await buildScreenplayPdf(book(...sequences));
      expect((await PDFDocument.load(bytes)).getPageCount()).toBe(estimatePages(sequences));
    }
    // Sequences run on from one another, as the editor counts them.
    const parts = [html(NIGHT_SHIFT), html(NIGHT_SHIFT), html(NIGHT_SHIFT.slice(0, 5))];
    const bytes = await buildScreenplayPdf(book(...parts));
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(estimatePages(parts));
  });

  it("sets an empty script as one blank page", async () => {
    const doc = await PDFDocument.load(await buildScreenplayPdf(book("")));
    expect(doc.getPageCount()).toBe(1);
  });

  it("sets a transition flush right and a scene heading in bold", async () => {
    const bytes = await buildScreenplayPdf(
      book(html([{ element: "scene-heading", text: "int. a - day" }, { element: "transition", text: "cut to:" }]))
    );
    const [page] = await drawn(bytes);
    const transition = page.find((p) => p.text === "CUT TO:")!;
    expect(transition.x + 7 * 7.2).toBeCloseTo(108 + 60 * 7.2, 5);
    expect(page.find((p) => p.text === "INT. A - DAY")).toBeTruthy();
    const doc = await PDFDocument.load(bytes);
    expect(JSON.stringify([...doc.context.enumerateIndirectObjects()].map(([, o]) => String(o)))).toContain("Courier-Bold");
  });

  it("draws inline marks in their own fonts and underlines", async () => {
    const content = scriptBlocksToHtml([
      { element: "action", runs: [{ text: "A " }, { text: "bold", bold: true }, { text: " and " }, { text: "under", underline: true }, { text: "." }] },
    ]);
    const bytes = await buildScreenplayPdf(book(content));
    const [page] = await drawn(bytes);
    expect(page.map((p) => p.text)).toEqual(["A ", "bold", " and ", "under", "."]);
    [0, 2, 6, 11, 16].forEach((col, i) => expect(page[i].x).toBeCloseTo(108 + col * 7.2, 5));
    const doc = await PDFDocument.load(bytes);
    const fonts = [...doc.context.enumerateIndirectObjects()].map(([, o]) => String(o)).join("");
    expect(fonts).toContain("Courier-Bold");
  });

  it("keeps Spanish accents and punctuation", async () => {
    const bytes = await buildScreenplayPdf(
      book(html([{ element: "action", text: "¿Qué hacés, niño? ¡Ñandú! Él cantó." }]))
    );
    const [page] = await drawn(bytes);
    expect(page.map((p) => p.text).join("")).toBe("¿Qué hacés, niño? ¡Ñandú! Él cantó.");
  });

  it("refuses a script in a writing system Courier cannot set", async () => {
    const chinese = book(html([{ element: "action", text: "他看着窗外的雨，什么也没说。" }]));
    expect(screenplayPdfSupported(chinese)).toBe(false);
    await expect(buildScreenplayPdf(chinese)).rejects.toBeInstanceOf(UnsupportedScriptError);
    expect(screenplayPdfSupported(book(html([{ element: "action", text: "Quoth the raven: 123, ¡nunca más!" }])))).toBe(true);
  });

  it("judges the script whole, not sequence by sequence", async () => {
    const english = html([{ element: "action", text: "The rain keeps falling on the empty street. ".repeat(10) }]);
    const hello = html([{ element: "dialogue", text: "你好" }]);
    expect(screenplayPdfSupported(book(english, hello))).toBe(true);
    await expect(buildScreenplayPdf(book(english, hello))).resolves.toBeInstanceOf(Uint8Array);
  });

  it("breaks a row at a pasted line or paragraph separator, as the editor's page count does", async () => {
    const blocks: ScriptBlock[] = [{ element: "action", text: "First line.\u2028Second line.\u2029Third line." }];
    const bytes = await buildScreenplayPdf(book(html(blocks)));
    const [page] = (await drawn(bytes)).map(asText);
    expect(page.text).toBe(pagesAsText(typesetSequences([blocks]).pages)[0]);
    expect(page.text.split("\n").slice(0, 3)).toEqual(["First line.", "Second line.", "Third line."]);
    expect(estimatePages([html(blocks)])).toBe(1);
  });
});
