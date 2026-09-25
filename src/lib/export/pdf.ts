import { PDFDocument, type PDFFont, type PDFPage, StandardFonts, rgb } from "pdf-lib";
import { type Block, type Run, htmlToBlocks } from "./blocks";
import { type BookProject, chapterTitle, sortedChapters } from "./types";

// Book-style PDF: 6x9in trade page, Times 11/15pt, justified text with
// first-line indents, one chapter per page start, title page, contents with
// page numbers, and a centered folio. Pure JS (pdf-lib) so it runs on Workers.
//
// Standard PDF fonts only cover Latin (WinAnsi) text. Characters outside that
// set fall back to an unaccented form or "?" rather than failing the export.

const PAGE_W = 432;
const PAGE_H = 648;
const MARGIN_X = 58;
const MARGIN_TOP = 64;
const MARGIN_BOTTOM = 68;
const TEXT_W = PAGE_W - MARGIN_X * 2;
const BODY_SIZE = 11;
const LEADING = 15.5;
const INDENT = 18;
const INK = rgb(0.1, 0.1, 0.1);
const MUTED = rgb(0.4, 0.4, 0.4);

type Fonts = { regular: PDFFont; bold: PDFFont; italic: PDFFont; boldItalic: PDFFont };

const REPLACEMENTS: Record<string, string> = {
  " ": " ",
  " ": " ",
  " ": " ",
  " ": " ",
  " ": " ",
  " ": " ",
  "\t": " ",
  "‐": "-",
  "‑": "-",
  "‒": "-",
  "―": "—",
  "−": "-",
  "​": "",
  "‌": "",
  "‍": "",
  "﻿": "",
  " ": "\n",
};

function sanitize(text: string, supported: Set<number>): string {
  let out = "";
  for (const ch of text) {
    const mapped = REPLACEMENTS[ch] ?? ch;
    for (const c of mapped) {
      const code = c.codePointAt(0) ?? 0;
      if (c === "\n" || supported.has(code)) {
        out += c;
        continue;
      }
      const base = c.normalize("NFD").replace(/[̀-ͯ]/g, "");
      out += base && [...base].every((b) => supported.has(b.codePointAt(0) ?? 0)) ? base : "?";
    }
  }
  return out;
}

function pickFont(fonts: Fonts, bold?: boolean, italic?: boolean): PDFFont {
  if (bold && italic) return fonts.boldItalic;
  if (bold) return fonts.bold;
  if (italic) return fonts.italic;
  return fonts.regular;
}

type Piece = { text: string; font: PDFFont; width: number; space: boolean; br?: boolean };
type Line = { pieces: Piece[]; hard: boolean };

function toPieces(
  runs: Run[],
  fonts: Fonts,
  size: number,
  supported: Set<number>,
  force: { bold?: boolean; italic?: boolean } = {}
): Piece[] {
  const pieces: Piece[] = [];
  let pendingSpace = false;
  for (const run of runs) {
    const font = pickFont(fonts, run.bold || force.bold, run.italic || force.italic);
    const text = sanitize(run.text, supported);
    for (const part of text.split(/( +|\n)/)) {
      if (!part) continue;
      if (part === "\n") {
        pieces.push({ text: "", font, width: 0, space: false, br: true });
        pendingSpace = false;
      } else if (part[0] === " ") {
        pendingSpace = true;
      } else {
        pieces.push({ text: part, font, width: font.widthOfTextAtSize(part, size), space: pendingSpace });
        pendingSpace = false;
      }
    }
  }
  if (pieces[0]) pieces[0].space = false;
  return pieces;
}

function breakLines(pieces: Piece[], size: number, width: number, firstIndent: number): Line[] {
  const lines: Line[] = [];
  let current: Piece[] = [];
  let used = 0;
  const limit = (n: number) => (n === 0 ? width - firstIndent : width);
  const spaceOf = (p: Piece) => p.font.widthOfTextAtSize(" ", size);

  const flush = (hard: boolean) => {
    lines.push({ pieces: current, hard });
    current = [];
    used = 0;
  };

  for (const piece of pieces) {
    if (piece.br) {
      flush(true);
      continue;
    }
    let p = piece;
    while (true) {
      const gap = current.length && p.space ? spaceOf(p) : 0;
      const fits = used + gap + p.width <= limit(lines.length);
      if (fits) {
        current.push(current.length ? p : { ...p, space: false });
        used += gap + p.width;
        break;
      }
      if (current.length) {
        flush(false);
        continue;
      }
      // A single word wider than the line: split it by characters.
      const room = limit(lines.length);
      let cut = 1;
      while (cut < p.text.length && p.font.widthOfTextAtSize(p.text.slice(0, cut + 1), size) <= room) cut += 1;
      const head = p.text.slice(0, cut);
      current.push({ ...p, text: head, width: p.font.widthOfTextAtSize(head, size), space: false });
      flush(false);
      const rest = p.text.slice(cut);
      p = { ...p, text: rest, width: p.font.widthOfTextAtSize(rest, size), space: false };
      if (!rest) break;
    }
  }
  if (current.length || !lines.length) flush(true);
  return lines;
}

class Writer {
  page!: PDFPage;
  y = 0;
  onNewPage: (page: PDFPage) => void = () => {};

  constructor(
    readonly doc: PDFDocument,
    readonly fonts: Fonts,
    readonly supported: Set<number>
  ) {}

  newPage(): PDFPage {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.y = PAGE_H - MARGIN_TOP;
    this.onNewPage(this.page);
    return this.page;
  }

  get remaining(): number {
    return this.y - MARGIN_BOTTOM;
  }

  private drawLine(
    line: Line,
    x0: number,
    width: number,
    size: number,
    justify: boolean,
    center: boolean,
    firstIndent: number,
    isFirst: boolean
  ) {
    const startX = x0 + (isFirst ? firstIndent : 0);
    const avail = width - (isFirst ? firstIndent : 0);
    const spaceW = this.fonts.regular.widthOfTextAtSize(" ", size);
    const natural = line.pieces.reduce((sum, p, i) => sum + p.width + (i && p.space ? spaceW : 0), 0);
    const gaps = line.pieces.filter((p, i) => i > 0 && p.space).length;
    const stretch = justify && !line.hard && gaps > 0 ? Math.max(0, (avail - natural) / gaps) : 0;
    let x = center ? x0 + (width - natural) / 2 : startX;
    line.pieces.forEach((p, i) => {
      if (i > 0 && p.space) x += spaceW + stretch;
      this.page.drawText(p.text, { x, y: this.y, size, font: p.font, color: INK });
      x += p.width;
    });
  }

  paragraph(
    runs: Run[],
    opts: {
      size?: number;
      leading?: number;
      indent?: number;
      left?: number;
      right?: number;
      justify?: boolean;
      center?: boolean;
      spaceBefore?: number;
      spaceAfter?: number;
      keepWithNext?: boolean;
      bold?: boolean;
      italic?: boolean;
      marker?: string;
    } = {}
  ) {
    const size = opts.size ?? BODY_SIZE;
    const leading = opts.leading ?? LEADING;
    const left = opts.left ?? 0;
    const width = TEXT_W - left - (opts.right ?? 0);
    const indent = opts.indent ?? 0;
    const pieces = toPieces(runs, this.fonts, size, this.supported, opts);
    if (!pieces.length) return;
    const lines = breakLines(pieces, size, width, indent);

    if (this.remaining < (opts.spaceBefore ?? 0) + leading) this.newPage();
    else if (this.y < PAGE_H - MARGIN_TOP) this.y -= opts.spaceBefore ?? 0;

    let i = 0;
    while (i < lines.length) {
      const left0 = lines.length - i;
      const fit = Math.max(1, Math.floor((this.remaining + (leading - size)) / leading));
      let take = Math.min(left0, fit);
      if (take < left0) {
        // Avoid a stranded first or last line across a page break.
        if (i === 0 && take === 1 && left0 > 1) take = 0;
        else if (left0 - take === 1 && take > 2) take -= 1;
      }
      if (i === 0 && opts.keepWithNext && take === left0 && this.remaining - take * leading < leading * 2) take = 0;
      if (take <= 0) {
        this.newPage();
        continue;
      }
      for (let k = 0; k < take; k++) {
        this.y -= size;
        const idx = i + k;
        if (idx === 0 && opts.marker) {
          const mw = this.fonts.regular.widthOfTextAtSize(opts.marker, size);
          this.page.drawText(opts.marker, {
            x: MARGIN_X + left - mw - 5,
            y: this.y,
            size,
            font: this.fonts.regular,
            color: INK,
          });
        }
        this.drawLine(
          lines[idx],
          MARGIN_X + left,
          width,
          size,
          opts.justify ?? false,
          opts.center ?? false,
          indent,
          idx === 0
        );
        this.y -= leading - size;
      }
      i += take;
      if (i < lines.length) this.newPage();
    }
    this.y -= opts.spaceAfter ?? 0;
  }
}

function centeredText(
  page: PDFPage,
  text: string,
  y: number,
  font: PDFFont,
  size: number,
  color = INK
) {
  const w = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: (PAGE_W - w) / 2, y, size, font, color });
}

function wrapPlain(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(next, size) > width) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

const TOC_ROW = 22;
const TOC_ROWS_PER_PAGE = Math.floor((PAGE_H - MARGIN_TOP - MARGIN_BOTTOM - 70) / TOC_ROW);

export async function buildPdf(project: BookProject, now: Date = new Date()): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const title = project.title.trim() || "Untitled Manuscript";
  const author = project.author.trim();
  doc.setTitle(title);
  if (author) doc.setAuthor(author);
  doc.setCreator("Ciciro");
  doc.setProducer("Ciciro");
  doc.setCreationDate(now);
  doc.setModificationDate(now);

  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.TimesRoman),
    bold: await doc.embedFont(StandardFonts.TimesRomanBold),
    italic: await doc.embedFont(StandardFonts.TimesRomanItalic),
    boldItalic: await doc.embedFont(StandardFonts.TimesRomanBoldItalic),
  };
  const supported = new Set(fonts.regular.getCharacterSet());
  const clean = (s: string) => sanitize(s, supported).replace(/\n/g, " ");

  const chapters = sortedChapters(project);
  const w = new Writer(doc, fonts, supported);

  // --- Title page ---
  const titlePage = doc.addPage([PAGE_W, PAGE_H]);
  const titleLines = wrapPlain(clean(title), fonts.regular, 28, TEXT_W);
  let ty = PAGE_H - 210;
  for (const line of titleLines) {
    centeredText(titlePage, line, ty, fonts.regular, 28);
    ty -= 36;
  }
  if (project.genre?.trim()) {
    centeredText(titlePage, clean(project.genre.trim()), ty - 4, fonts.italic, 12, MUTED);
    ty -= 24;
  }
  if (author) {
    titlePage.drawLine({
      start: { x: PAGE_W / 2 - 24, y: ty - 18 },
      end: { x: PAGE_W / 2 + 24, y: ty - 18 },
      thickness: 0.6,
      color: MUTED,
    });
    centeredText(titlePage, clean(author), ty - 48, fonts.regular, 14);
  }

  // --- Contents (reserve pages first so chapter page numbers are known) ---
  const tocPageCount = Math.max(1, Math.ceil(chapters.length / TOC_ROWS_PER_PAGE));
  const tocPages = Array.from({ length: tocPageCount }, () => doc.addPage([PAGE_W, PAGE_H]));
  const frontCount = 1 + tocPageCount;

  // --- Chapters ---
  const starts: number[] = [];
  const chapterOpeners = new Set<number>();
  w.onNewPage = (page) => {
    const index = doc.getPageIndices().length - 1;
    const number = index - frontCount + 1;
    if (chapterOpeners.has(index)) return;
    centeredText(page, String(number), MARGIN_BOTTOM - 30, fonts.regular, 9.5, MUTED);
  };

  chapters.forEach((ch, i) => {
    const heading = chapterTitle(ch, i);
    const blocks = htmlToBlocks(ch.content);
    chapterOpeners.add(doc.getPageIndices().length);
    w.newPage();
    starts.push(doc.getPageIndices().length - frontCount);
    w.y -= 96;
    const titleRuns: Run[] = [{ text: heading }];
    w.paragraph(titleRuns, { size: 20, leading: 26, center: true, spaceAfter: 6 });
    w.page.drawLine({
      start: { x: PAGE_W / 2 - 18, y: w.y - 2 },
      end: { x: PAGE_W / 2 + 18, y: w.y - 2 },
      thickness: 0.6,
      color: MUTED,
    });
    w.y -= 34;

    if (!blocks.length) {
      w.paragraph([{ text: "This chapter is empty.", italic: true }], { center: true });
      return;
    }
    let flush = true; // next paragraph is flush left (chapter start, after heading or break)
    for (const b of blocks as Block[]) {
      switch (b.type) {
        case "paragraph":
          w.paragraph(b.runs, { justify: true, indent: flush ? 0 : INDENT });
          flush = false;
          break;
        case "heading":
          w.paragraph(b.runs, {
            size: b.level === 1 ? 15 : 13,
            leading: 19,
            bold: true,
            spaceBefore: 16,
            spaceAfter: 6,
            keepWithNext: true,
          });
          flush = true;
          break;
        case "quote":
          w.paragraph(b.runs, { italic: true, left: 24, right: 24, justify: true, spaceBefore: 4, spaceAfter: 4 });
          flush = true;
          break;
        case "list-item":
          w.paragraph(b.runs, { left: 22, marker: b.marker, spaceAfter: 3 });
          flush = true;
          break;
        case "break":
          w.paragraph([{ text: "*   *   *" }], { center: true, spaceBefore: 8, spaceAfter: 8, keepWithNext: true });
          flush = true;
          break;
      }
    }
  });

  // --- Draw the contents now that chapter pages are known ---
  const tocX = MARGIN_X + 8;
  const tocW = TEXT_W - 16;
  tocPages.forEach((page, p) => {
    if (p === 0) centeredText(page, "Contents", PAGE_H - MARGIN_TOP - 26, fonts.regular, 20);
    const rows = chapters.slice(p * TOC_ROWS_PER_PAGE, (p + 1) * TOC_ROWS_PER_PAGE);
    let y = PAGE_H - MARGIN_TOP - 80;
    rows.forEach((ch, r) => {
      const idx = p * TOC_ROWS_PER_PAGE + r;
      const num = String(starts[idx]);
      const numW = fonts.regular.widthOfTextAtSize(num, BODY_SIZE);
      let label = clean(chapterTitle(ch, idx));
      const maxLabel = tocW - numW - 24;
      while (label.length > 1 && fonts.regular.widthOfTextAtSize(label, BODY_SIZE) > maxLabel) {
        label = label.slice(0, -1);
      }
      if (label !== clean(chapterTitle(ch, idx))) label = `${label.trimEnd()}...`;
      const labelW = fonts.regular.widthOfTextAtSize(label, BODY_SIZE);
      page.drawText(label, { x: tocX, y, size: BODY_SIZE, font: fonts.regular, color: INK });
      page.drawText(num, { x: tocX + tocW - numW, y, size: BODY_SIZE, font: fonts.regular, color: INK });
      // Dot leader
      const dot = fonts.regular.widthOfTextAtSize(". ", BODY_SIZE);
      const from = tocX + labelW + 8;
      const to = tocX + tocW - numW - 8;
      if (to - from > dot) {
        page.drawText(". ".repeat(Math.floor((to - from) / dot)), {
          x: from,
          y,
          size: BODY_SIZE,
          font: fonts.regular,
          color: MUTED,
        });
      }
      y -= TOC_ROW;
    });
  });

  return doc.save();
}
