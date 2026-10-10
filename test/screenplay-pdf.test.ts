import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  UnsupportedScriptError,
  buildScreenplayPdf as buildWithSettings,
  screenplayPdfSupported,
} from "@/lib/export/screenplay-pdf";
import { scriptBlocksToHtml } from "@/lib/fountain";
import {
  DEFAULT_SCRIPT_SETTINGS,
  estimatePages,
  pagesAsText,
  typesetSequences,
  type ScriptBlock,
  type ScriptSettings,
} from "@/lib/screenplay";
import { NIGHT_SHIFT } from "./fixtures/screenplay/night-shift";
import { longScript } from "./fixtures/screenplay/long-script";

const PAGE_H = 792;

/** The script's pages alone: no title page unless a test asks for one. */
const BARE: ScriptSettings = { ...DEFAULT_SCRIPT_SETTINGS, showTitlePage: false };
const buildScreenplayPdf = (b: ReturnType<typeof book>, settings: ScriptSettings = BARE) => buildWithSettings(b, settings);

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

const html = (blocks: ScriptBlock[]) =>
  scriptBlocksToHtml(blocks.map((b) => ({ element: b.element, runs: [{ text: b.text }], ...(b.dual ? { dual: true } : {}) })));
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

const withSettings = (changes: Partial<ScriptSettings>): ScriptSettings => ({ ...DEFAULT_SCRIPT_SETTINGS, ...changes });
const titlePage = (changes: Partial<ScriptSettings["titlePage"]>) => ({ ...DEFAULT_SCRIPT_SETTINGS.titlePage, ...changes });

describe("screenplay PDF title page", () => {
  const script = html(NIGHT_SHIFT);

  it("is the first page, unnumbered, and the script keeps its own page numbers", async () => {
    const bare = await PDFDocument.load(await buildScreenplayPdf(book(script)));
    const bytes = await buildWithSettings(
      book(script),
      withSettings({
        titlePage: titlePage({ title: "Night Shift", author: "A. Writer", contact: "A. Writer\n12 Main St", draftDate: "Oct 2026" }),
      })
    );
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(bare.getPageCount() + 1);
    const pages = await drawn(bytes);
    // Script page 1 is unnumbered; page 2 says "2." even though it is the third page of the file.
    expect(pages.map((p) => asText(p).number)).toEqual(pages.map((_, i) => (i < 2 ? "" : `${i}.`)));
  });

  it("centers the title in capitals, with the credit and author under it", async () => {
    const bytes = await buildWithSettings(
      book(script),
      withSettings({ titlePage: titlePage({ title: "Night Shift", credit: "Screenplay by", author: "A. Writer", source: "Based on a story" }) })
    );
    const [first] = await drawn(bytes);
    const at = (text: string) => first.find((p) => p.text === text)!;
    for (const [text, row] of [
      ["NIGHT SHIFT", 16],
      ["Screenplay by", 18],
      ["A. Writer", 20],
      ["Based on a story", 22],
    ] as const) {
      const p = at(text);
      expect(p, text).toBeTruthy();
      expect(p.x + (text.length * 7.2) / 2).toBeCloseTo(108 + 216, 5);
      expect(p.y).toBeCloseTo(PAGE_H - 72 - row * 12 - 9.6, 5);
    }
  });

  it("puts the contact lower left and the draft date lower right", async () => {
    const bytes = await buildWithSettings(
      book(script),
      withSettings({ titlePage: titlePage({ title: "T", contact: "Jo Writer\n12 Main St\njo@example.com", draftDate: "Oct 2026" }) })
    );
    const [first] = await drawn(bytes);
    const lastRow = PAGE_H - 72 - 53 * 12 - 9.6;
    expect(first.find((p) => p.text === "jo@example.com")).toMatchObject({ x: 108, y: expect.closeTo(lastRow, 5) });
    expect(first.find((p) => p.text === "Jo Writer")!.y).toBeCloseTo(lastRow + 24, 5);
    const date = first.find((p) => p.text === "Oct 2026")!;
    expect(date.x + 8 * 7.2).toBeCloseTo(108 + 432, 5);
    expect(date.y).toBeCloseTo(lastRow, 5);
  });

  it("falls back to the manuscript's title and author, and can be turned off", async () => {
    const on = await drawn(await buildWithSettings(book(script), DEFAULT_SCRIPT_SETTINGS));
    expect(on[0].map((p) => p.text)).toEqual(["NIGHT SHIFT", "Written by", "A. Writer"]);
    const off = await drawn(await buildWithSettings(book(script), withSettings({ showTitlePage: false })));
    expect(off[0].map((p) => p.text)).not.toContain("NIGHT SHIFT");
  });

  it("judges the script and its title page each on their own", async () => {
    const chinese = withSettings({ titlePage: titlePage({ title: "夜班", author: "李明", source: "根据一个故事改编" }) });
    const english = book(html([{ element: "action", text: "The rain keeps falling on the empty street. ".repeat(10) }]));
    // A title page set wholly in Chinese is refused, not printed as "??", even over an English script.
    expect(screenplayPdfSupported(english, chinese)).toBe(false);
    expect(screenplayPdfSupported(english, withSettings({ ...chinese, showTitlePage: false }))).toBe(true);
    // A little CJK among English words (an author's name) is "?", not a refusal.
    const named = withSettings({ titlePage: titlePage({ title: "Night Shift", author: "李明", source: "Based on a true story" }) });
    expect(screenplayPdfSupported(english, named)).toBe(true);
    // The PDF's own "Written by" and English title page words never rescue a script in another language.
    const mostly = book(html([{ element: "action", text: "他看着窗外的雨，什么也没说。" }]));
    expect(screenplayPdfSupported(mostly, DEFAULT_SCRIPT_SETTINGS)).toBe(false);
    expect(screenplayPdfSupported(mostly, withSettings({ showTitlePage: false }))).toBe(false);
    // A blank credit is the PDF's own: it does not make a Chinese title page look half English.
    const credit = withSettings({ titlePage: titlePage({ title: "夜班", author: "李明" }) });
    expect(screenplayPdfSupported(english, credit)).toBe(false);
  });
});

describe("screenplay PDF professional layout", () => {
  const dual: ScriptBlock[] = [
    { element: "scene-heading", text: "int. bar - night" },
    { element: "character", text: "mara" },
    { element: "dialogue", text: "I told you." },
    { element: "character", text: "jonah", dual: true },
    { element: "parenthetical", text: "quietly" },
    { element: "dialogue", text: "You did, and I listened to every word." },
    { element: "centered", text: "the end" },
  ];

  it("draws both speeches of a dual pair on the same rows, and centers centered text", async () => {
    const bytes = await buildScreenplayPdf(book(html(dual)));
    const [page] = (await drawn(bytes)).map(asText);
    expect(page.text).toBe(pagesAsText(typesetSequences([dual]).pages)[0]);
    const [placed] = await drawn(bytes);
    const mara = placed.find((p) => p.text === "MARA")!;
    const jonah = placed.find((p) => p.text === "JONAH")!;
    expect(jonah.y).toBeCloseTo(mara.y, 5);
    expect(mara.x).toBeCloseTo(108 + 8 * 7.2, 5);
    expect(jonah.x).toBeCloseTo(108 + 40 * 7.2, 5);
    const end = placed.find((p) => p.text === "the end")!;
    expect(end.x).toBeCloseTo(108 + (432 - 7 * 7.2) / 2, 5);
  });

  it("draws (MORE) and the repeated cue where the engine puts them, and the PDF still has the editor's pages", async () => {
    const long = (n: number): ScriptBlock => ({
      element: "dialogue",
      text: Array.from({ length: n }, (_, i) => `line${String(i).padStart(2, "0")}`.padEnd(35, "a")).join(" "),
    });
    const blocks: ScriptBlock[] = [
      ...Array.from({ length: 20 }, (_, i): ScriptBlock => ({ element: "action", text: `Filler ${i}.` })),
      { element: "character", text: "mara" },
      long(20),
    ];
    const bytes = await buildScreenplayPdf(book(html(blocks)));
    const texts = (await drawn(bytes)).map(asText);
    expect(texts.map((p) => p.text)).toEqual(pagesAsText(typesetSequences([blocks]).pages));
    expect(texts[0].text.trimEnd().endsWith("(MORE)")).toBe(true);
    expect(texts[1].text.split("\n")[0]).toBe(`${" ".repeat(22)}MARA (CONT'D)`);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(estimatePages([html(blocks)]));
    // With the notes off, the same speech runs plain.
    const plain = (await drawn(await buildScreenplayPdf(book(html(blocks)), withSettings({ showTitlePage: false, more: false, contd: false })))).map(asText);
    expect(plain.some((p) => p.text.includes("(MORE)") || p.text.includes("CONT'D"))).toBe(false);
  });

  it("numbers scenes in both margins when asked, bold, level with the heading", async () => {
    const blocks: ScriptBlock[] = [
      { element: "scene-heading", text: "int. a - day" },
      { element: "action", text: "Quiet." },
      { element: "scene-heading", text: "ext. b - night" },
    ];
    const bytes = await buildScreenplayPdf(book(html(blocks)), withSettings({ showTitlePage: false, sceneNumbers: true }));
    const [page] = await drawn(bytes);
    const ones = page.filter((p) => p.text === "1");
    expect(ones).toHaveLength(2);
    const heading = page.find((p) => p.text === "INT. A - DAY")!;
    expect(ones.every((p) => Math.abs(p.y - heading.y) < 0.001)).toBe(true);
    expect(Math.min(...ones.map((p) => p.x))).toBeLessThan(108);
    expect(Math.max(...ones.map((p) => p.x))).toBeGreaterThanOrEqual(540);
    expect(page.filter((p) => p.text === "2")).toHaveLength(2);
    // And the page count is the editor's, numbers or not.
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(estimatePages([html(blocks)], { sceneNumbers: true }));
  });
});
