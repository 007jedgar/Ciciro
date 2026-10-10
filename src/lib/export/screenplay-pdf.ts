import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import {
  DEFAULT_SCRIPT_SETTINGS,
  ELEMENT_METRICS,
  PAGE_LINES,
  hasTitlePageText,
  pageOptionsOf,
  resolveTitlePage,
  runsText,
  scriptPdfSupported,
  styledBlocksFromHtml,
  typesetSequences,
  wrapText,
  type PageCell,
  type ScriptSettings,
  type StyledBlock,
  type StyledRun,
  type TitlePage,
} from "../screenplay";
import { sanitize } from "./pdf";
import { sortedChapters, type BookProject } from "./types";

// Screenplay-format PDF: US Letter, Courier 12pt at 10 characters an inch, the
// script set on the page by the same engine that counts the editor's pages
// (src/lib/screenplay.ts, `typesetSequences`), so this file has exactly the
// pages the author saw. The left margin is 1.5in, the top and bottom 1.0in;
// page numbers sit top right from the script's page 2. A title page comes first
// when the script's settings ask for one; it is not a numbered page. Courier is
// a standard PDF font, so only Latin (WinAnsi) text is set: English and
// Spanish. Dual dialogue is two columns of one row, `(MORE)` and the repeated
// `NAME (CONT'D)` cue are rows the engine adds, and scene numbers sit in both
// margins when the settings number the scenes (docs/screenplay.md).

const IN = 72;
const PAGE_W = 8.5 * IN;
const PAGE_H = 11 * IN;
const SIZE = 12;
const LEADING = 12; // 6 lines an inch
const LEFT = 1.5 * IN;
const TOP = 1.0 * IN;
const RIGHT = PAGE_W - 1.0 * IN;
const CELL = SIZE * 0.6; // Courier advances 0.6em: 7.2pt, 10 characters an inch
const NUMBER_TOP = 0.5 * IN;
const BASELINE = LEADING * 0.8;
const INK = rgb(0, 0, 0);

/** Where the title page's title sits: this many lines below the top margin. */
const TITLE_LINE = 16;
/** The title page's contact block is this many columns wide. */
const CONTACT_COLUMNS = 30;

const BOLD = 1;
const ITALIC = 2;
const UNDERLINE = 4;

/** The script is in a writing system the standard Courier fonts cannot set. */
export class UnsupportedScriptError extends Error {
  constructor() {
    super(
      "The screenplay PDF is only available for scripts in English and Spanish for now. Support for more languages is planned."
    );
    this.name = "UnsupportedScriptError";
  }
}

type Fonts = { regular: PDFFont; bold: PDFFont; italic: PDFFont; boldItalic: PDFFont };

function pickFont(fonts: Fonts, flags: number): PDFFont {
  if (flags & BOLD && flags & ITALIC) return fonts.boldItalic;
  if (flags & BOLD) return fonts.bold;
  if (flags & ITALIC) return fonts.italic;
  return fonts.regular;
}

/** The marks on each UTF-16 unit of a block's text. */
function flagsOf(runs: readonly StyledRun[]): Uint8Array {
  const flags = new Uint8Array(runsText(runs).length);
  let at = 0;
  for (const run of runs) {
    const f = (run.bold ? BOLD : 0) | (run.italic ? ITALIC : 0) | (run.underline ? UNDERLINE : 0);
    flags.fill(f, at, at + run.text.length);
    at += run.text.length;
  }
  return flags;
}

type Segment = { text: string; flags: number };

/** A row's text cut where its marks change. `shift` is how far the row's text sits ahead of the block's. */
function segments(text: string, flags: Uint8Array, start: number, lead: number, bold: boolean): Segment[] {
  const out: Segment[] = [];
  for (let j = 0; j < text.length; j++) {
    const offset = start + j - lead;
    const f = (offset >= 0 && offset < flags.length ? flags[offset] : 0) | (bold ? BOLD : 0);
    const last = out[out.length - 1];
    if (last && last.flags === f) last.text += text[j];
    else out.push({ text: text[j], flags: f });
  }
  return out;
}

/** Whether a script, taken whole, is in text the screenplay PDF can set (its title page included when shown). */
export function screenplayPdfSupported(book: BookProject, settings: ScriptSettings = DEFAULT_SCRIPT_SETTINGS): boolean {
  return scriptPdfSupported(
    sortedChapters(book).map((c) => c.content),
    settings,
    book
  );
}

/** A script as a screenplay-format PDF. Throws `UnsupportedScriptError` for a script this font cannot set. */
export async function buildScreenplayPdf(
  book: BookProject,
  settings: ScriptSettings = DEFAULT_SCRIPT_SETTINGS
): Promise<Uint8Array> {
  if (!screenplayPdfSupported(book, settings)) throw new UnsupportedScriptError();
  const sequences: StyledBlock[][] = sortedChapters(book).map((c) => styledBlocksFromHtml(c.content));
  const set = typesetSequences(
    sequences.map((blocks) => blocks.map((b) => ({ element: b.element, text: runsText(b.runs), dual: b.dual }))),
    pageOptionsOf(settings)
  );
  const flagCache = new Map<StyledBlock, Uint8Array>();
  const blockFlags = (block: StyledBlock) => {
    let flags = flagCache.get(block);
    if (!flags) flagCache.set(block, (flags = flagsOf(block.runs)));
    return flags;
  };
  const titlePage = resolveTitlePage(settings.titlePage, book);

  const doc = await PDFDocument.create();
  doc.setTitle(titlePage.title || book.title || "Screenplay");
  if (titlePage.author) doc.setAuthor(titlePage.author);
  doc.setCreator("Ciciro");
  doc.setProducer("Ciciro");
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Courier),
    bold: await doc.embedFont(StandardFonts.CourierBold),
    italic: await doc.embedFont(StandardFonts.CourierOblique),
    boldItalic: await doc.embedFont(StandardFonts.CourierBoldOblique),
  };
  const supported = new Set(fonts.regular.getCharacterSet());

  /** The width of a line as drawn: sanitized to what Courier can set. */
  const width = (text: string, font: PDFFont = fonts.regular) =>
    font.widthOfTextAtSize(sanitize(text, supported), SIZE);
  /** A line of text with its first column at `x`, its baseline `row` lines below the top margin. */
  const draw = (page: PDFPage, text: string, x: number, row: number, font: PDFFont = fonts.regular) => {
    const clean = sanitize(text, supported);
    if (clean) page.drawText(clean, { x, y: PAGE_H - TOP - row * LEADING - BASELINE, size: SIZE, font, color: INK });
  };

  if (settings.showTitlePage && hasTitlePageText(titlePage)) {
    drawTitlePage(doc.addPage([PAGE_W, PAGE_H]), titlePage, { draw, width }, fonts);
  }

  /** One cell of a row: the column where its marks change, in its own font, underlined where marked. */
  const drawCell = (page: PDFPage, cell: PageCell, row: number, flags: Uint8Array, bold: boolean) => {
    if (cell.text === "") return;
    const parts = segments(cell.text, flags, cell.start, cell.lead, bold).map((s) => {
      const font = pickFont(fonts, s.flags);
      const text = sanitize(s.text, supported);
      return { text, font, underline: (s.flags & UNDERLINE) !== 0, width: font.widthOfTextAtSize(text, SIZE) };
    });
    const total = parts.reduce((sum, p) => sum + p.width, 0);
    const measure = cell.width * CELL;
    let x = LEFT + cell.indent * CELL;
    if (cell.align === "right") x += measure - total;
    else if (cell.align === "center") x += (measure - total) / 2;
    const y = PAGE_H - TOP - row * LEADING - BASELINE;
    for (const p of parts) {
      if (p.text) page.drawText(p.text, { x, y, size: SIZE, font: p.font, color: INK });
      if (p.underline && p.width > 0) {
        page.drawLine({ start: { x, y: y - 1.5 }, end: { x: x + p.width, y: y - 1.5 }, thickness: 0.6, color: INK });
      }
      x += p.width;
    }
  };

  const pages = set.pages.length > 0 ? set.pages : [[]];
  pages.forEach((rows, index) => {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    if (index > 0) {
      const number = `${index + 1}.`;
      page.drawText(number, {
        x: RIGHT - fonts.regular.widthOfTextAtSize(number, SIZE),
        y: PAGE_H - NUMBER_TOP - BASELINE,
        size: SIZE,
        font: fonts.regular,
        color: INK,
      });
    }
    rows.forEach((row, r) => {
      if (!row) return;
      // The engine's own notes ((MORE), the repeated cue) carry no marks of their own.
      const flags = row.synthetic ? new Uint8Array(0) : blockFlags(sequences[row.sequence][row.block]);
      const bold = row.synthetic ? false : row.bold;
      drawCell(page, row, r, flags, bold);
      if (row.right) drawCell(page, row.right, r, blockFlags(sequences[row.sequence][row.right.block]), row.right.bold);
      if (row.sceneNumber) {
        // The number sits in both margins, level with the heading.
        draw(page, row.sceneNumber, LEFT - CELL - width(row.sceneNumber, fonts.bold), r, fonts.bold);
        draw(page, row.sceneNumber, RIGHT + CELL, r, fonts.bold);
      }
    });
  });
  return doc.save();
}

/**
 * The title page: the title in capitals about a third of the way down, centered
 * on the 60 column measure, with the credit, the author and the source below it;
 * the contact block lower left and the draft date lower right. No page number.
 */
function drawTitlePage(
  page: PDFPage,
  titlePage: TitlePage,
  pen: {
    draw: (page: PDFPage, text: string, x: number, row: number, font?: PDFFont) => void;
    width: (text: string, font?: PDFFont) => number;
  },
  fonts: Fonts
): void {
  const { draw, width } = pen;
  const measure = ELEMENT_METRICS.action.width;
  const centered = (text: string, row: number, font: PDFFont = fonts.regular) => {
    draw(page, text, LEFT + (measure * CELL - width(text, font)) / 2, row, font);
  };
  let row = TITLE_LINE;
  const block = (text: string, font?: PDFFont, caps = false) => {
    if (!text.trim()) return;
    for (const line of text.split("\n")) {
      for (const l of wrapText(caps ? line.toUpperCase() : line, measure)) centered(l.text, row++, font);
    }
    row++; // a blank line between
  };
  block(titlePage.title, fonts.bold, true);
  block(titlePage.credit);
  block(titlePage.author);
  block(titlePage.source);

  const contact = titlePage.contact
    .split("\n")
    .flatMap((line) => (line.trim() ? wrapText(line, CONTACT_COLUMNS).map((l) => l.text) : [""]));
  const bottom = PAGE_LINES - 1;
  contact.forEach((line, i) => draw(page, line, LEFT, bottom - (contact.length - 1) + i));
  if (titlePage.draftDate.trim()) draw(page, titlePage.draftDate, RIGHT - width(titlePage.draftDate), bottom);
}
