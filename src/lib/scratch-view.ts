// The scratchpad's shapes and limits, shared by the store, the routes, and the
// web panel. Notes are plain text; they are not chapters, so they never enter
// word counts, writing-day stats, search, or exports.

export const SCRATCH_TITLE_MAX = 120;
export const SCRATCH_CONTENT_MAX = 100_000;
export const SCRATCH_NOTES_MAX = 200;

export type ScratchNote = {
  id: string;
  projectId: string;
  title: string;
  content: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type ScratchNoteCreate = { title?: string; content?: string };

export type ScratchNotePatch = {
  title?: string;
  content?: string;
  /** The revision the edit was made against; a stale one is refused with 409. */
  expectedRevision?: number;
};

/** What a list row shows: the title, else the first line of the note. */
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
