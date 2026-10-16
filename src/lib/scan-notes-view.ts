// Pure helpers for "Scan notes" (the phone photographs handwritten or printed
// notes; see src/lib/scan-notes.ts for the server side): what the vision model
// may return, how a photo's size and type are checked, how the writer's
// reviewed text is appended to a story bible file, and how it becomes cards on
// the planning canvas. Nothing here touches the database or the model.
//
// Scanned text is never written to a chapter. A bible file only ever gains a
// dated section at its end, and the canvas only ever gains new cards.

import {
  CANVAS_BODY_MAX,
  CANVAS_CARDS_MAX,
  CANVAS_ROW_HEIGHT,
  CANVAS_TITLE_MAX,
  placeOutline,
  type OutlineNode,
  type PlacedOutlineCard,
} from "@/lib/canvas-view";
import { KNOWS_START } from "@/lib/knowledge-view";

export const SCAN_PAGES_MAX = 6;
/** The model's own cap per image is 5 MB; the phone sends about a tenth of that. */
export const SCAN_PAGE_BYTES_MAX = 5 * 1024 * 1024;
export const SCAN_TEXT_MAX = 24000;
export const SCAN_TITLE_MAX = 60;

export const SCAN_KINDS = ["outline", "character", "world", "plot", "timeline", "other"] as const;
export type ScanKind = (typeof SCAN_KINDS)[number];

export type ScanLegibility = "clear" | "partial" | "unreadable";

/** One photo's read: `failed` means the reading itself went wrong (not that the page is blank). */
export type ScanPage = { text: string; legibility: ScanLegibility; failed: boolean };

export type ScanReading = {
  /** Every page, in order, joined by a blank line. Empty when nothing could be read. */
  text: string;
  pages: ScanPage[];
  /** What the notes mostly are. Only ever a default for the destination picker. */
  kind: ScanKind;
  /** A short label from the notes themselves (a heading, a name), or "". */
  title: string;
  /** ok: all read. partial: some words or a page are doubtful. unreadable: no text at all. */
  status: "ok" | "partial" | "unreadable";
  /** How many `[?]` and `[illegible]` marks the text holds. */
  uncertain: number;
};

export type ScanImageType = "image/jpeg" | "image/png" | "image/webp";

/** The image type from the file's own first bytes, or null for anything the model cannot read. */
export function sniffImageType(bytes: Uint8Array): ScanImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!) === "RIFF" &&
    String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

const UNCERTAIN_MARK = /\[\?\]|\[illegible\]/gi;

/** `[?]` (a guess) and `[illegible]` (no guess) marks left in the text. */
export function countUncertain(text: string): number {
  return text.match(UNCERTAIN_MARK)?.length ?? 0;
}

/** Line endings, control characters, stray trailing spaces and runs of blank lines tidied; nothing reworded. */
export function normalizeNotesText(raw: string): string {
  const cleaned = raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned.slice(0, SCAN_TEXT_MAX).trimEnd();
}

function asKind(value: unknown): ScanKind {
  return (SCAN_KINDS as readonly string[]).includes(value as string) ? (value as ScanKind) : "other";
}

function asLegibility(value: unknown): ScanLegibility | null {
  return value === "clear" || value === "partial" || value === "unreadable" ? value : null;
}

/** The JSON the vision model must reply with for each photo (structured output: it always parses). */
export const SCAN_READ_SCHEMA = {
  type: "object",
  properties: {
    text: { type: "string", description: "The transcription. Empty when nothing can be read." },
    legibility: { type: "string", enum: ["clear", "partial", "unreadable"] },
    kind: { type: "string", enum: [...SCAN_KINDS] },
    title: { type: "string", description: "A 2 to 6 word label taken from the notes, or empty." },
  },
  required: ["text", "legibility", "kind", "title"],
  additionalProperties: false,
} as const;

export type PageReading = { text: string; legibility: ScanLegibility; kind: ScanKind; title: string };

/**
 * One photo's reply as a reading, or null when it is not one at all. A page
 * that came back with words is never called unreadable.
 */
export function parsePageReading(input: unknown): PageReading | null {
  if (!input || typeof input !== "object") return null;
  const src = input as Record<string, unknown>;
  if (typeof src.text !== "string") return null;
  const text = normalizeNotesText(src.text);
  const said = asLegibility(src.legibility);
  let legibility: ScanLegibility;
  if (!text) legibility = "unreadable";
  else if (said === "unreadable" || countUncertain(text) > 0) legibility = "partial";
  else legibility = said ?? "clear";
  const title =
    typeof src.title === "string"
      ? src.title.replace(/^#+\s*/, "").replace(/\s+/g, " ").trim().slice(0, SCAN_TITLE_MAX)
      : "";
  return { text, legibility, kind: asKind(src.kind), title };
}

/**
 * The photos' readings, in the order they were taken, as one scan. A photo
 * whose read went wrong (null) is an unreadable page, never a guess; the kind
 * is the one most pages agree on and the title the first the notes offer.
 */
export function combinePages(readings: readonly (PageReading | null)[]): ScanReading {
  const pages: ScanPage[] = readings.map((reading) =>
    reading
      ? { text: reading.text, legibility: reading.legibility, failed: false }
      : { text: "", legibility: "unreadable", failed: true }
  );
  const text = normalizeNotesText(pages.map((page) => page.text).filter(Boolean).join("\n\n"));
  const uncertain = countUncertain(text);

  const votes = new Map<ScanKind, number>();
  for (const reading of readings) {
    if (reading && reading.text && reading.kind !== "other") votes.set(reading.kind, (votes.get(reading.kind) ?? 0) + 1);
  }
  let kind: ScanKind = "other";
  let best = 0;
  for (const [candidate, count] of votes) {
    if (count > best) {
      kind = candidate;
      best = count;
    }
  }
  const title = readings.find((reading) => reading && reading.text && reading.title)?.title ?? "";

  let status: ScanReading["status"];
  if (!text) status = "unreadable";
  else if (uncertain > 0 || pages.some((page) => page.legibility !== "clear")) status = "partial";
  else status = "ok";
  return { text, pages, kind, title, status, uncertain };
}

// ---------------------------------------------------------------------------
// Where the reviewed text goes

export type ScanDestination =
  | { type: "bible"; mode: "append"; path: string }
  | { type: "bible"; mode: "new"; kind: "character" | "plot"; name: string }
  | { type: "canvas" };

export type ScanApplyInput = { text: string; destination: ScanDestination };

export const SCAN_NAME_MAX = 80;

/** The request body of an apply, checked, or the sentence that says what is wrong. */
export function parseScanApply(body: unknown): { ok: true; value: ScanApplyInput } | { ok: false; error: string } {
  const src = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const text = typeof src.text === "string" ? normalizeNotesText(src.text) : "";
  if (!text) return { ok: false, error: "There are no notes to add." };

  const dest = src.destination && typeof src.destination === "object" ? (src.destination as Record<string, unknown>) : {};
  if (dest.type === "canvas") return { ok: true, value: { text, destination: { type: "canvas" } } };
  if (dest.type === "bible" && dest.mode === "append") {
    const path = typeof dest.path === "string" ? dest.path.trim() : "";
    if (!path) return { ok: false, error: "Choose a story bible file." };
    return { ok: true, value: { text, destination: { type: "bible", mode: "append", path } } };
  }
  if (dest.type === "bible" && dest.mode === "new") {
    const kind = dest.kind === "character" || dest.kind === "plot" ? dest.kind : null;
    const name = typeof dest.name === "string" ? dest.name.replace(/\s+/g, " ").trim().slice(0, SCAN_NAME_MAX) : "";
    if (!kind) return { ok: false, error: "Choose a character or a plot line." };
    if (!name) return { ok: false, error: "Name the new entry first." };
    return { ok: true, value: { text, destination: { type: "bible", mode: "new", kind, name } } };
  }
  return { ok: false, error: "Choose where to add the notes." };
}

// --- Story bible ----------------------------------------------------------

/** Push every heading in the notes down two levels, so a scanned "# Title" sits under our own section heading. */
export function demoteHeadings(text: string, by = 2): string {
  return text
    .split("\n")
    .map((line) => {
      const match = /^(#{1,6})(\s+.*)$/.exec(line);
      if (!match) return line;
      return `${"#".repeat(Math.min(6, match[1]!.length + by))}${match[2]}`;
    })
    .join("\n");
}

/** The dated section a scan adds to a bible file. */
export function scannedSection(text: string, date: string): string {
  return `## Scanned notes (${date})\n\n${demoteHeadings(text)}`;
}

/**
 * `existing` with the notes added as a dated section at the end. The file's
 * own text is never touched; the who-knows-what mirror block, when the file
 * has one, stays last. Adding the same section again changes nothing, so a
 * retry after a lost reply does not duplicate it.
 */
export function appendScannedNotes(existing: string, text: string, date: string): string {
  const section = scannedSection(text, date);
  const base = existing.trimEnd();
  if (base.endsWith(section)) return existing;
  const block = existing.indexOf(KNOWS_START);
  if (block !== -1) {
    const before = existing.slice(0, block).trimEnd();
    const mirror = existing.slice(block).trimEnd();
    if (before.endsWith(section)) return existing;
    return `${before ? `${before}\n\n` : ""}${section}\n\n${mirror}\n`;
  }
  return base ? `${base}\n\n${section}\n` : `${section}\n`;
}

// --- Canvas ---------------------------------------------------------------

const TITLE_SOFT_MAX = 80;
const DEPTH_MAX = 6;
const ROOTS_PER_BAND = 4;
const HEADING = /^(#{1,6})\s+(.*)$/;
const MARKER = /^(?:[-*\u2022\u00b7\u25aa\u25e6\u2013\u2014]|\d{1,3}[.)]|[A-Za-z][.)])\s+/;
const CHECKBOX = /^\[[ xX]\]\s*/;

/** A card's title and body from one line of notes: a short line is all title; a long one keeps every word. */
export function splitCardText(text: string): { title: string; body: string } {
  if (text.length <= TITLE_SOFT_MAX) return { title: text, body: "" };
  const sentence = /^(.{6,100}?[.!?])(?:\s+|$)/.exec(text);
  if (sentence) {
    return { title: sentence[1]!.replace(/[.!?]+$/, ""), body: text.slice(sentence[0].length).trim() };
  }
  const cut = text.slice(0, TITLE_SOFT_MAX);
  const space = cut.lastIndexOf(" ");
  return { title: `${(space > 40 ? cut.slice(0, space) : cut).trimEnd()}…`, body: text };
}

type Draft = { text: string; indent: number; children: Draft[] };

/**
 * Notes as a tree of cards. A heading is a card and the lines under it are its
 * children; an indented bullet nests under the bullet above it; an indented
 * line with no marker continues the line above it. Everything else is a card
 * of its own, in reading order. An empty tree means there was nothing to add.
 */
export function notesToOutline(text: string): OutlineNode[] {
  const roots: Draft[] = [];
  // Rank orders nesting: a heading ranks by its depth (below any bullet), a line by its indent.
  const stack: { rank: number; node: Draft }[] = [];
  let previous: { node: Draft; indent: number; heading: boolean } | null = null;

  for (const raw of text.replace(/\t/g, "  ").split("\n")) {
    if (!raw.trim()) continue;
    const indent = raw.length - raw.trimStart().length;
    let line = raw.trim();

    const heading = HEADING.exec(line);
    if (heading) {
      line = heading[2]!.trim();
    } else if (MARKER.test(line)) {
      line = line.replace(MARKER, "").replace(CHECKBOX, "").trim();
    } else if (previous && !previous.heading && indent > previous.indent) {
      previous.node.text = `${previous.node.text} ${line}`;
      continue;
    }
    if (!line) continue;

    const rank = heading ? (heading[1]!.length - 7) * 1000 : indent;
    while (stack.length && stack[stack.length - 1]!.rank >= rank) stack.pop();
    while (stack.length >= DEPTH_MAX) stack.pop();
    const node: Draft = { text: line, indent, children: [] };
    (stack.length ? stack[stack.length - 1]!.node.children : roots).push(node);
    stack.push({ rank, node });
    previous = { node, indent, heading: Boolean(heading) };
  }

  function toNode(draft: Draft): OutlineNode {
    const { title, body } = splitCardText(draft.text);
    return {
      title: title.slice(0, CANVAS_TITLE_MAX),
      body: body.slice(0, CANVAS_BODY_MAX),
      children: draft.children.map(toNode),
    };
  }
  return roots.map(toNode);
}

export function countOutlineCards(nodes: readonly OutlineNode[]): number {
  return nodes.reduce((sum, node) => sum + 1 + countOutlineCards(node.children), 0);
}

function outlineDepth(node: OutlineNode): number {
  return node.children.length ? 1 + Math.max(...node.children.map(outlineDepth)) : 0;
}

/** Where new cards start so they land below everything on the board: its left edge, one row under its lowest card. */
export function boardOrigin(cards: readonly { x: number; y: number }[]): { x: number; top: number } {
  if (!cards.length) return { x: 80, top: 80 };
  return {
    x: Math.min(...cards.map((card) => card.x)),
    top: Math.max(...cards.map((card) => card.y)) + CANVAS_ROW_HEIGHT,
  };
}

/**
 * Place the notes' cards below the existing board. Roots wrap into bands of a
 * few, each band laid out as a tree with its children a row below, so a long
 * flat list reads down the board instead of off to one side.
 */
export function layoutScannedOutline(
  nodes: readonly OutlineNode[],
  origin: { x: number; top: number }
): PlacedOutlineCard[] {
  const placed: PlacedOutlineCard[] = [];
  let top = origin.top;
  for (let start = 0, band = 0; start < nodes.length; start += ROOTS_PER_BAND, band++) {
    const chunk = nodes.slice(start, start + ROOTS_PER_BAND);
    // placeOutline puts depth 0 one row below its origin.
    const cards = placeOutline(chunk, { x: origin.x, y: top - CANVAS_ROW_HEIGHT });
    for (const card of cards) {
      placed.push({
        ...card,
        key: `b${band}-${card.key}`,
        parentKey: card.parentKey ? `b${band}-${card.parentKey}` : null,
      });
    }
    top += (1 + Math.max(...chunk.map(outlineDepth))) * CANVAS_ROW_HEIGHT;
  }
  return placed;
}

/** What the board can still take, for the sentence that explains why nothing was added. */
export function cardRoom(existing: number): number {
  return Math.max(0, CANVAS_CARDS_MAX - existing);
}
