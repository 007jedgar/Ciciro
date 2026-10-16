// "Scan notes": photograph handwritten or printed notes, read them into text,
// review and edit it, then add it to the story bible or the canvas. The
// server reads the photos and adds the reviewed text (src/lib/scan-notes.ts);
// this is the phone's share of it with no native module in it: the page list,
// how big a photo is sent, why a scan failed, and where the text goes.
// lib/notes-scan-capture.ts holds the camera, the library and the resize.

import { failureFromError } from "./chat-errors";
import { bibleFileLabel } from "./bible-files";
import type { BibleEntry, ScanApplyRequest, ScanKind } from "./api/types";

/** The server reads this many photos at once. */
export const SCAN_PAGES_MAX = 6;

/**
 * The longest side a photo is sent at. The model reads at about this size
 * whatever it is given, so a 12-megapixel original only costs upload time.
 */
export const SCAN_IMAGE_EDGE = 1800;
export const SCAN_JPEG_QUALITY = 0.8;

/** One photo waiting to be read, with its size so the resize needs no second look at the file. */
export type ScanPageDraft = { id: string; uri: string; width: number; height: number };

/** The photos so far with `photos` added in order, up to the cap; `dropped` is how many did not fit. */
export function addScanPages(
  current: readonly ScanPageDraft[],
  photos: readonly { uri: string; width: number; height: number }[],
  makeId: () => string
): { pages: ScanPageDraft[]; dropped: number } {
  const room = Math.max(0, SCAN_PAGES_MAX - current.length);
  const taken = photos.slice(0, room);
  return {
    pages: [...current, ...taken.map((photo) => ({ ...photo, id: makeId() }))],
    dropped: photos.length - taken.length,
  };
}

export function removeScanPage(current: readonly ScanPageDraft[], id: string): ScanPageDraft[] {
  return current.filter((page) => page.id !== id);
}

/** The size to resize a photo to, or null when it is already no bigger than the cap. */
export function scanResizeTarget(
  width: number,
  height: number,
  edge: number = SCAN_IMAGE_EDGE
): { width: number; height: number } | null {
  if (!(width > 0) || !(height > 0)) return null;
  const longest = Math.max(width, height);
  if (longest <= edge) return null;
  const scale = edge / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

// --- Why a scan failed ----------------------------------------------------

export type ScanFailureKind =
  /** No connection. The photos are kept, and reading works once it is back. */
  | "offline"
  /** This month's AI allowance is used up. */
  | "limit"
  /** The photos are too big to send. */
  | "tooLarge"
  /** The model or the server is having trouble: worth another try. */
  | "busy"
  | "timeout"
  /** The server cannot read photos at all (no model key). */
  | "unavailable"
  | "unknown";

export type ScanFailure = { kind: ScanFailureKind; plan?: "free" | "pro" };

export function scanFailure(error: unknown): ScanFailure {
  const failure = failureFromError(error);
  switch (failure.code) {
    case "network":
      return { kind: "offline" };
    case "aiLimit":
      return { kind: "limit", plan: failure.plan };
    case "tooLong":
      return { kind: "tooLarge" };
    case "timeout":
      return { kind: "timeout" };
    case "rateLimit":
    case "overloaded":
    case "upstream":
      return { kind: failure.status === 503 ? "unavailable" : "busy" };
    case "auth":
    case "permission":
      return { kind: "unavailable" };
    default:
      return { kind: "unknown" };
  }
}

/** Whether another try could work without the writer changing anything. */
export function scanFailureRetryable(kind: ScanFailureKind): boolean {
  return kind !== "limit" && kind !== "tooLarge" && kind !== "unavailable";
}

// --- The reading ------------------------------------------------------------

const UNCERTAIN_MARK = /\[\?\]|\[illegible\]/gi;

/** `[?]` (a guess) and `[illegible]` (no guess) marks the writer still has to settle. */
export function uncertainCount(text: string): number {
  return text.match(UNCERTAIN_MARK)?.length ?? 0;
}

/** Where the cursor goes to the next mark after `from`, wrapping to the first; null when there is none. */
export function nextUncertainRange(text: string, from: number): { start: number; end: number } | null {
  const marks = [...text.matchAll(UNCERTAIN_MARK)];
  if (marks.length === 0) return null;
  const next = marks.find((mark) => (mark.index ?? 0) >= from) ?? marks[0]!;
  const start = next.index ?? 0;
  return { start, end: start + next[0].length };
}

// --- Where it goes ----------------------------------------------------------

export type ScanDestinationChoice =
  | { kind: "bible-file"; path: string }
  | { kind: "bible-new"; entry: "character" | "plot"; name: string }
  | { kind: "canvas" };

/** The request that adds `text` there, or null while the choice is not finished (a new entry with no name). */
export function applyRequest(choice: ScanDestinationChoice | null, text: string): ScanApplyRequest | null {
  const body = text.trim();
  if (!choice || !body) return null;
  if (choice.kind === "canvas") return { text: body, destination: { type: "canvas" } };
  if (choice.kind === "bible-file") {
    return choice.path ? { text: body, destination: { type: "bible", mode: "append", path: choice.path } } : null;
  }
  const name = choice.name.replace(/\s+/g, " ").trim();
  return name ? { text: body, destination: { type: "bible", mode: "new", kind: choice.entry, name } } : null;
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Where the notes probably belong, as a starting point the writer can change:
 * a list of scenes goes to the canvas, world and plot notes to their files,
 * and a person to their character file when there is one (a new one named
 * from the notes when there is not). Notes that are none of those start with
 * nothing chosen.
 */
export function suggestDestination(
  reading: { kind: ScanKind; title: string },
  files: readonly BibleEntry[]
): ScanDestinationChoice | null {
  switch (reading.kind) {
    case "outline":
      return { kind: "canvas" };
    case "world":
      return { kind: "bible-file", path: "world.md" };
    case "plot":
      return { kind: "bible-file", path: "plot.md" };
    case "timeline":
      return { kind: "bible-file", path: "timeline.md" };
    case "character": {
      const wanted = slug(reading.title);
      const match = wanted
        ? files.find((file) => file.path.startsWith("characters/") && slug(bibleFileLabel(file.path)) === wanted)
        : undefined;
      if (match) return { kind: "bible-file", path: match.path };
      return { kind: "bible-new", entry: "character", name: reading.title };
    }
    default:
      return null;
  }
}

/** The bible files a scan can be added to, in the order the list shows them: the five core files, characters, plot lines. */
export function appendableFiles(files: readonly BibleEntry[]): BibleEntry[] {
  const rank = (path: string) => (path.startsWith("characters/") ? 1 : path.startsWith("plot/") ? 2 : 0);
  return files.filter((file) => file.path.endsWith(".md")).sort((a, b) => rank(a.path) - rank(b.path));
}

/** The scanner for a manuscript. `to` starts it on a destination (the canvas's empty state asks for "canvas"). */
export function scanNotesHref(projectId: string, to?: "bible" | "canvas"): string {
  return `/project/${projectId}/scan-notes${to ? `?to=${to}` : ""}`;
}
