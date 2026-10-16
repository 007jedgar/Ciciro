import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { authorizeOwnedProject } from "@/lib/auth/access";
import { AuthError, type PublicUser } from "@/lib/auth/session";
import { EDITOR_MODEL, getAnthropic, hasAnthropicKey } from "@/lib/anthropic";
import { meterAiRun, refundAiRun } from "@/lib/entitlements";
import { SCAN_NOTES_SYSTEM } from "@/lib/prompts";
import {
  emptyCharacterFile,
  emptyPlotLineFile,
  ensureBible,
  getBibleFile,
  normalizeBiblePath,
  writeBibleFile,
} from "@/lib/bible";
import { CANVAS_CARDS_MAX } from "@/lib/canvas-view";
import {
  SCAN_PAGE_BYTES_MAX,
  SCAN_PAGES_MAX,
  SCAN_READ_SCHEMA,
  appendScannedNotes,
  boardOrigin,
  cardRoom,
  combinePages,
  countOutlineCards,
  isEntryFor,
  layoutScannedOutline,
  newEntryPaths,
  notesToOutline,
  parsePageReading,
  parseScanApply,
  sniffImageType,
  type PageReading,
  type ScanDestination,
  type ScanImageType,
  type ScanReading,
} from "@/lib/scan-notes-view";

// Scan notes. The phone sends photos of handwritten or printed notes; a vision
// model transcribes them and the writer reviews and edits the text on the
// phone. Only then is it added, and only to the story bible (as a dated
// section at the end of a file, or a new character / plot-line file) or to the
// planning canvas (as new cards). It is never written to a chapter and never
// replaces what is already there.
//
// Reading is the one metered step: one AI run per scan, refunded when it fails
// or finds no text. The photos are held in memory for the one request and are
// never stored or logged; adding the reviewed text is free.

// Handwriting is the hard case for a vision model, and a wrong word is quietly
// kept in the writer's notes, so this uses the editor's model rather than the
// drafter's. On a set of photographed notes (print hand, pencil cursive,
// Spanish, Chinese, Hindi) the editor's model kept every line and word where
// the drafter's joined two lines and garbled a Hindi word, for a similar few
// seconds a page. Neither takes a forced tool_choice, so the reply is held to
// its shape with structured output. Each photo is read by its own call, in
// parallel: a scan takes as long as its slowest page rather than the sum (a
// phone request that sits idle for a minute is dropped), and one page that
// fails leaves the others intact. The scan is still one AI run.
export const SCAN_MODEL = EDITOR_MODEL;
const SCAN_MAX_TOKENS = 4000;

export type ScanPhoto = { data: Uint8Array };

const READ_FAILED = "Couldn't read the photos right now. Try again.";

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/** One photo through the model, as a reading. Throws when the call or its reply is no good. */
async function readPage(data: Uint8Array, type: ScanImageType): Promise<PageReading> {
  const res = await getAnthropic().messages.create({
    model: SCAN_MODEL,
    max_tokens: SCAN_MAX_TOKENS,
    system: SCAN_NOTES_SYSTEM,
    // These models take no forced tool_choice; structured output is how a reply is held to a shape.
    output_config: { format: { type: "json_schema", schema: SCAN_READ_SCHEMA } },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: type, data: toBase64(data) } },
          { type: "text", text: "A photo of my notes. Transcribe it." },
        ],
      },
    ],
  });
  // A reply cut off at the cap is half a page; never hand that onward as if it were all.
  if (res.stop_reason === "max_tokens") throw new Error("reply cut off");
  const reply = res.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply);
  } catch {
    throw new Error("reply is not JSON");
  }
  const reading = parsePageReading(parsed);
  if (!reading) throw new Error("no reading");
  return reading;
}

/**
 * Read the photos into text. Throws before any model call when a photo is the
 * wrong type or too big. One AI run is charged, and given back when no page
 * could be read at all or the photos hold no writing.
 */
export async function readScannedNotes(
  projectId: string,
  user: PublicUser | null,
  photos: ScanPhoto[]
): Promise<ScanReading> {
  await authorizeOwnedProject(projectId, user);
  if (photos.length === 0) throw new AuthError("Add a photo of your notes first.", 400);
  if (photos.length > SCAN_PAGES_MAX) {
    throw new AuthError(`Scan up to ${SCAN_PAGES_MAX} photos at a time.`, 400);
  }
  const types: ScanImageType[] = [];
  for (const photo of photos) {
    if (photo.data.byteLength > SCAN_PAGE_BYTES_MAX) {
      throw new AuthError("A photo is too large to read (5 MB limit).", 413);
    }
    const type = sniffImageType(photo.data);
    if (!type) throw new AuthError("Photos must be JPEG, PNG or WebP images.", 415);
    types.push(type);
  }
  if (!hasAnthropicKey()) {
    throw new AuthError("Reading notes needs an ANTHROPIC_API_KEY.", 503);
  }

  await meterAiRun(user);
  let readings: (PageReading | null)[];
  try {
    readings = await Promise.all(photos.map((photo, i) => readPage(photo.data, types[i]!).catch(() => null)));
    if (readings.every((reading) => reading === null)) throw new AuthError(READ_FAILED, 502);
  } catch (error) {
    await refundAiRun(user);
    throw error;
  }
  const reading = combinePages(readings);
  // The writer got nothing from a scan that found no writing, so it costs nothing.
  if (reading.status === "unreadable") await refundAiRun(user);
  return reading;
}

export type ScanApplyResult =
  | { destination: "bible"; path: string; revision: number; created: boolean }
  | { destination: "canvas"; cards: number; arrows: number };

const APPEND_ATTEMPTS = 4;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function appendToBibleFile(projectId: string, path: string, text: string) {
  for (let attempt = 0; attempt < APPEND_ATTEMPTS; attempt++) {
    const row = await getBibleFile(projectId, path);
    if (!row) throw new AuthError("That story bible file no longer exists.", 404);
    const next = appendScannedNotes(row.content, text, today());
    if (next === row.content) return { path: row.path, revision: row.revision };
    try {
      const saved = await writeBibleFile(projectId, path, next, row.revision);
      return { path: saved.path, revision: saved.revision };
    } catch (error) {
      // The file changed under us (the chat, the web editor): read it again and add to the new text.
      if (error instanceof AuthError && error.status === 409) continue;
      throw error;
    }
  }
  throw new AuthError("That file keeps changing. Try adding the notes again.", 409);
}

function newEntryFile(kind: "character" | "plot", name: string): string {
  return kind === "character" ? emptyCharacterFile(name) : emptyPlotLineFile(name);
}

async function addToBible(
  projectId: string,
  destination: Extract<ScanDestination, { type: "bible" }>,
  text: string
): Promise<ScanApplyResult> {
  await ensureBible(projectId);
  if (destination.mode === "append") {
    let path: string;
    try {
      path = normalizeBiblePath(destination.path);
    } catch (error) {
      throw new AuthError((error as Error).message, 400);
    }
    const saved = await appendToBibleFile(projectId, path, text);
    return { destination: "bible", ...saved, created: false };
  }
  // A new entry never replaces an existing file: the notes join the one for the same
  // name, and a different name that would land on the same path takes the next free one.
  for (const path of newEntryPaths(destination.kind, destination.name)) {
    const existing = await getBibleFile(projectId, path);
    if (existing && !isEntryFor(existing.content, destination.name)) continue;
    if (!existing) await writeBibleFile(projectId, path, newEntryFile(destination.kind, destination.name));
    const saved = await appendToBibleFile(projectId, path, text);
    return { destination: "bible", ...saved, created: !existing };
  }
  throw new AuthError("There are too many entries with that name. Choose another name.", 409);
}

async function addToCanvas(projectId: string, text: string): Promise<ScanApplyResult> {
  const nodes = notesToOutline(text);
  const count = countOutlineCards(nodes);
  if (count === 0) throw new AuthError("There are no notes to add.", 400);
  const existing = await prisma.canvasCard.findMany({ where: { projectId }, select: { x: true, y: true } });
  if (count > cardRoom(existing.length)) {
    throw new AuthError(
      `These notes make ${count} cards and the board has room for ${cardRoom(existing.length)} more (it holds ${CANVAS_CARDS_MAX}). Nothing was added.`,
      400
    );
  }
  const placed = layoutScannedOutline(nodes, boardOrigin(existing));
  // One batch: D1 cannot run an interactive transaction, and a second batch for the
  // arrows would leave the cards behind if it failed.
  const ids = placed.map(() => crypto.randomUUID());
  const idByKey = new Map(placed.map((card, index) => [card.key, ids[index]!]));
  const arrows = placed.filter((card) => card.parentKey);
  await prisma.$transaction([
    ...placed.map((card, index) =>
      prisma.canvasCard.create({
        data: { id: ids[index], projectId, title: card.title, body: card.body, x: card.x, y: card.y },
      })
    ),
    ...arrows.map((card) =>
      prisma.canvasEdge.create({
        data: { projectId, fromId: idByKey.get(card.parentKey!)!, toId: idByKey.get(card.key)! },
      })
    ),
  ]);
  return { destination: "canvas", cards: placed.length, arrows: arrows.length };
}

/**
 * Add the reviewed text where the writer chose. Adds only: a bible file gets a
 * dated section at its end (a new character or plot line is created first, or
 * joined when it already exists) and the canvas gets new cards below the
 * existing ones.
 */
export async function applyScannedNotes(
  projectId: string,
  user: PublicUser | null,
  body: unknown
): Promise<ScanApplyResult> {
  await authorizeOwnedProject(projectId, user);
  const parsed = parseScanApply(body);
  if (!parsed.ok) throw new AuthError(parsed.error, 400);
  const { text, destination } = parsed.value;
  if (destination.type === "canvas") return addToCanvas(projectId, text);
  return addToBible(projectId, destination, text);
}
