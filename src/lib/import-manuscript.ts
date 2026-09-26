import { prisma } from "@/lib/db";
import { AuthError, authorizeProjectId, requireUserIfHosted, type PublicUser } from "@/lib/auth/session";
import { planNewChapters, type NewChapterFields } from "@/lib/chapters";
import { resolveFolderId } from "@/lib/folders";
import { importFile, ImportError, type ImportedManuscript } from "@/lib/import";
import { stampBlockIds } from "@/lib/manuscript";
import { countWords, htmlToText } from "@/lib/text";

export type ImportInput = {
  filename: string;
  data: Uint8Array;
  /** Append to this manuscript. Absent: create a new one. */
  projectId?: string;
  /** New manuscripts only. */
  title?: string;
  author?: string;
  folderId?: unknown;
};

export type ImportResult = {
  projectId: string;
  title: string;
  appended: boolean;
  chapters: { id: string; title: string; order: number; wordCount: number }[];
};

function parse(input: ImportInput): ImportedManuscript {
  try {
    return importFile(input.filename, input.data);
  } catch (error) {
    if (error instanceof ImportError) throw new AuthError(error.message, 422);
    throw error;
  }
}

/**
 * Import a Word, Markdown, HTML or Scrivener file as a new manuscript, or as
 * extra chapters at the end of an existing one. Chapters are written through
 * the same path as any new chapter: stamped block ids, a word count, revision 0.
 */
export async function importManuscript(
  user: PublicUser | null,
  input: ImportInput
): Promise<ImportResult> {
  requireUserIfHosted(user);
  if (input.projectId) await authorizeProjectId(input.projectId, user);
  const parsed = parse(input);

  let projectId = input.projectId;
  let title: string;
  let firstOrder = 0;
  let fields = (position: number, input: { title: string; content: string }): NewChapterFields => ({
    title: input.title || `Chapter ${position + 1}`,
    content: input.content,
  });
  if (projectId) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, title: true },
    });
    if (!project) throw new AuthError("Not found.", 404);
    title = project.title;
    const plan = await planNewChapters(projectId, parsed.chapters.length);
    fields = (position, input) => plan.fields(plan.visibleCount + position, input);
    const agg = await prisma.chapter.aggregate({ where: { projectId }, _max: { order: true } });
    firstOrder = (agg._max.order ?? -1) + 1;
  } else {
    const folderId = await resolveFolderId(user, input.folderId);
    const requested = input.title?.trim();
    title = requested || parsed.title || "Untitled Manuscript";
    const project = await prisma.project.create({
      data: {
        userId: user?.id ?? null,
        folderId: folderId ?? null,
        title,
        author: input.author?.trim() || user?.name || "",
      },
      select: { id: true },
    });
    projectId = project.id;
  }

  const created: ImportResult["chapters"] = [];
  for (const [i, chapter] of parsed.chapters.entries()) {
    const { title: chapterTitle, content } = fields(i, {
      title: chapter.title.trim().slice(0, 200),
      content: chapter.html ? stampBlockIds(chapter.html) : "",
    });
    const row = await prisma.chapter.create({
      data: {
        projectId,
        title: chapterTitle,
        order: firstOrder + i,
        content,
        wordCount: countWords(htmlToText(content)),
      },
      select: { id: true, title: true, order: true, wordCount: true },
    });
    created.push(row);
  }
  return { projectId, title, appended: Boolean(input.projectId), chapters: created };
}
