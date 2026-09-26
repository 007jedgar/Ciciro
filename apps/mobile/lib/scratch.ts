import { ApiError } from "./api/client";
import type { ScratchNote, ScratchNoteConflict } from "./api/types";

// The manuscript scratchpad on the phone: pure helpers the screens render from.
// Mirrors src/lib/scratch-view.ts on the web. Notes are not chapters, so none
// of this touches word counts, writing stats, or exports.

export const SCRATCH_TITLE_MAX = 120;
export const SCRATCH_CONTENT_MAX = 100_000;
/** Quiet time after the last keystroke before a note is saved. */
export const SCRATCH_SAVE_DELAY_MS = 800;

/** The title, else the first line of the note, else the fallback. */
export function scratchNoteTitle(
  note: Pick<ScratchNote, "title" | "content">,
  fallback: string
): string {
  const title = note.title.trim();
  if (title) return title;
  const firstLine = note.content
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine ? firstLine.slice(0, SCRATCH_TITLE_MAX) : fallback;
}

/** A short excerpt for the list, skipping the line used as the title. */
export function scratchNoteExcerpt(note: Pick<ScratchNote, "title" | "content">): string {
  const lines = note.content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const rest = note.title.trim() ? lines : lines.slice(1);
  return rest.join(" ").slice(0, 140);
}

/** The other device's version, when a save was refused because it moved on. */
export function scratchConflict(error: unknown): ScratchNoteConflict | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const body = error.body as Partial<ScratchNoteConflict> | null;
  if (!body || typeof body !== "object" || !body.note) return null;
  return body as ScratchNoteConflict;
}

export function scratchListHref(projectId: string): string {
  return `/project/${projectId}/scratch`;
}

export function scratchNoteHref(projectId: string, noteId: string): string {
  return `/project/${projectId}/scratch/${encodeURIComponent(noteId)}`;
}
