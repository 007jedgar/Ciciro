import type { ScratchNote as ScratchNoteRow } from "@prisma/client";
import { prisma } from "@/lib/db";
import { authorizeOwnedProject } from "@/lib/auth/access";
import { AuthError, type PublicUser } from "@/lib/auth/session";
import {
  SCRATCH_CONTENT_MAX,
  SCRATCH_NOTES_MAX,
  SCRATCH_TITLE_MAX,
  type ScratchNote,
} from "@/lib/scratch-view";

// The manuscript scratchpad: notes and research kept beside the chapters.
// Deliberately its own table. Chapter word counts, writing-day stats, search
// and exports all read chapters, so notes stay out of them by construction.

export function toScratchNote(row: ScratchNoteRow): ScratchNote {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    content: row.content,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function text(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new AuthError(`${field} must be a string.`, 400);
  if (value.length > max) throw new AuthError(`${field} is too long.`, 400);
  return value;
}

async function ownedNote(
  projectId: string,
  noteId: string,
  user: PublicUser | null
): Promise<ScratchNoteRow> {
  await authorizeOwnedProject(projectId, user);
  const row = await prisma.scratchNote.findFirst({ where: { id: noteId, projectId } });
  if (!row) throw new AuthError("Not found.", 404);
  return row;
}

/** Newest edit first. */
export async function listScratchNotes(
  projectId: string,
  user: PublicUser | null
): Promise<ScratchNote[]> {
  await authorizeOwnedProject(projectId, user);
  const rows = await prisma.scratchNote.findMany({
    where: { projectId },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
  });
  return rows.map(toScratchNote);
}

export async function createScratchNote(
  projectId: string,
  user: PublicUser | null,
  body: unknown
): Promise<ScratchNote> {
  await authorizeOwnedProject(projectId, user);
  const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const title = text(input.title, "title", SCRATCH_TITLE_MAX) ?? "";
  const content = text(input.content, "content", SCRATCH_CONTENT_MAX) ?? "";
  const count = await prisma.scratchNote.count({ where: { projectId } });
  if (count >= SCRATCH_NOTES_MAX) {
    throw new AuthError("This scratchpad is full. Delete a note to add another.", 409);
  }
  const row = await prisma.scratchNote.create({ data: { projectId, title, content } });
  return toScratchNote(row);
}

export async function getScratchNote(
  projectId: string,
  noteId: string,
  user: PublicUser | null
): Promise<ScratchNote> {
  return toScratchNote(await ownedNote(projectId, noteId, user));
}

/**
 * Save an edit. With `expectedRevision`, an edit made against an out-of-date
 * note is refused with 409 and the current note, so a second device never
 * silently overwrites the first. Without it the write is last-writer-wins.
 */
export async function updateScratchNote(
  projectId: string,
  noteId: string,
  user: PublicUser | null,
  body: unknown
): Promise<ScratchNote> {
  const current = await ownedNote(projectId, noteId, user);
  const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const title = text(input.title, "title", SCRATCH_TITLE_MAX);
  const content = text(input.content, "content", SCRATCH_CONTENT_MAX);
  const expected = input.expectedRevision;
  if (expected !== undefined && !Number.isInteger(expected)) {
    throw new AuthError("expectedRevision must be an integer.", 400);
  }
  if (title === undefined && content === undefined) {
    throw new AuthError("Nothing to update.", 400);
  }

  const refuse = async (): Promise<AuthError> => {
    const latest = await prisma.scratchNote.findUnique({ where: { id: noteId } });
    if (!latest) return new AuthError("Not found.", 404);
    const message = "This note changed on another device.";
    return new AuthError(message, 409, {
      error: message,
      currentRevision: latest.revision,
      note: toScratchNote(latest),
    });
  };

  if (typeof expected === "number" && expected !== current.revision) throw await refuse();

  // With an expected revision, guard the write on it so two writers racing past
  // the check above cannot both win. Without one, the last writer wins.
  const result = await prisma.scratchNote.updateMany({
    where: { id: noteId, ...(typeof expected === "number" ? { revision: expected } : {}) },
    data: {
      ...(title !== undefined ? { title } : {}),
      ...(content !== undefined ? { content } : {}),
      revision: { increment: 1 },
    },
  });
  if (result.count === 0) throw await refuse();
  const row = await prisma.scratchNote.findUniqueOrThrow({ where: { id: noteId } });
  return toScratchNote(row);
}

export async function deleteScratchNote(
  projectId: string,
  noteId: string,
  user: PublicUser | null
): Promise<void> {
  await ownedNote(projectId, noteId, user);
  await prisma.scratchNote.deleteMany({ where: { id: noteId, projectId } });
}
