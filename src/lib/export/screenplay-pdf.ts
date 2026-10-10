import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import {
  runsText,
  scriptTextSupported,
  styledBlocksFromHtml,
  typesetSequences,
  type StyledBlock,
  type StyledRun,
} from "../screenplay";
import { sanitize } from "./pdf";
import { sortedChapters, type BookProject } from "./types";

// Screenplay-format PDF: US Letter, Courier 12pt at 10 characters an inch, the
// script set on the page by the same engine that counts the editor's pages
// (src/lib/screenplay.ts, `typesetSequences`), so this file has exactly the
// pages the author saw ("about N pages"). The left margin is 1.5in, the top
// and bottom 1.0in; page numbers sit top right from page 2. Courier is a
// standard PDF font, so only Latin (WinAnsi) text is set: English and Spanish.
// No title page or (MORE)/(CONT'D) yet (docs/screenplay.md).

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

/** Whether every sequence of a script is in text the screenplay PDF can set. */
export function screenplayPdfSupported(book: BookProject): boolean {
  return sortedChapters(book).every((c) => scriptTextSupported(styledBlocksFromHtml(c.content).map((b) => runsText(b.runs)).join("\n")));
}

/** A script as a screenplay-format PDF. Throws `UnsupportedScriptError` for a script this font cannot set. */
export async function buildScreenplayPdf(book: BookProject): Promise<Uint8Array> {
  if (!screenplayPdfSupported(book)) throw new UnsupportedScriptError();
  const sequences: StyledBlock[][] = sortedChapters(book).map((c) => styledBlocksFromHtml(c.content));
  const set = typesetSequences(sequences.map((blocks) => blocks.map((b) => ({ element: b.element, text: runsText(b.runs) }))));
  const flagCache = new Map<StyledBlock, Uint8Array>();
  const blockFlags = (block: StyledBlock) => {
    let flags = flagCache.get(block);
    if (!flags) flagCache.set(block, (flags = flagsOf(block.runs)));
    return flags;
  };

  const doc = await PDFDocument.create();
  doc.setTitle(book.title || "Screenplay");
  if (book.author) doc.setAuthor(book.author);
  doc.setCreator("Ciciro");
  doc.setProducer("Ciciro");
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Courier),
    bold: await doc.embedFont(StandardFonts.CourierBold),
    italic: await doc.embedFont(StandardFonts.CourierOblique),
    boldItalic: await doc.embedFont(StandardFonts.CourierBoldOblique),
  };
  const supported = new Set(fonts.regular.getCharacterSet());

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
      if (!row || row.text === "") return;
      const block = sequences[row.sequence][row.block];
      const parts = segments(row.text, blockFlags(block), row.start, row.lead, row.bold).map((s) => {
        const font = pickFont(fonts, s.flags);
        const text = sanitize(s.text, supported);
        return { text, font, underline: (s.flags & UNDERLINE) !== 0, width: font.widthOfTextAtSize(text, SIZE) };
      });
      const total = parts.reduce((sum, p) => sum + p.width, 0);
      let x = row.align === "right" ? LEFT + (row.indent + row.width) * CELL - total : LEFT + row.indent * CELL;
      const y = PAGE_H - TOP - r * LEADING - BASELINE;
      for (const p of parts) {
        if (p.text) page.drawText(p.text, { x, y, size: SIZE, font: p.font, color: INK });
        if (p.underline && p.width > 0) {
          page.drawLine({ start: { x, y: y - 1.5 }, end: { x: x + p.width, y: y - 1.5 }, thickness: 0.6, color: INK });
        }
        x += p.width;
      }
    });
  });
  return doc.save();
}
