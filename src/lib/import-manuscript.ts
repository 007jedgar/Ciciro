import { prisma } from "@/lib/db";
import { AuthError, authorizeProjectId, requireUserIfHosted, type PublicUser } from "@/lib/auth/session";
import { planNewChapters, type NewChapterFields } from "@/lib/chapters";
import { resolveFolderId } from "@/lib/folders";
import { importFile, ImportError, type ImportedManuscript } from "@/lib/import";
import { nextChapterTitle } from "@/lib/manuscript-kind";
import { DEFAULT_SCRIPT_SETTINGS, serializeScriptSettings } from "@/lib/screenplay";
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
 * Import a Word, Markdown, HTML, Fountain, Final Draft (.fdx) or Scrivener file as a new manuscript,
 * or as extra chapters at the end of an existing one. A Fountain or FDX script becomes a
 * screenplay; added to a manuscript of another kind, its lines lose their
 * elements and read as paragraphs. Chapters are written through
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
  const kind = parsed.kind ?? "novel";
  let fields = (position: number, input: { title: string; content: string }): NewChapterFields => ({
    title: input.title || nextChapterTitle(kind, position),
    content: input.content,
  });
  // The lines of a script keep their elements only in a screenplay.
  let keepElements = kind === "screenplay";
  if (projectId) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, title: true },
    });
    if (!project) throw new AuthError("Not found.", 404);
    title = project.title;
    const plan = await planNewChapters(projectId, parsed.chapters.length);
    fields = (position, input) => plan.fields(plan.visibleCount + position, input);
    keepElements = plan.kind === "screenplay";
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
        author: input.author?.trim() || parsed.author || user?.name || "",
        kind,
        // A script keeps the title page and the numbered scenes its file carried.
        ...(parsed.script
          ? {
              scriptSettings: serializeScriptSettings({
                ...DEFAULT_SCRIPT_SETTINGS,
                titlePage: parsed.script.titlePage ?? DEFAULT_SCRIPT_SETTINGS.titlePage,
                sceneNumbers: parsed.script.sceneNumbers === true,
              }),
            }
          : {}),
      },
      select: { id: true },
    });
    projectId = project.id;
  }

  const created: ImportResult["chapters"] = [];
  for (const [i, chapter] of parsed.chapters.entries()) {
    const html = parsed.kind === "screenplay" && !keepElements ? chapter.html.replace(/ data-sp="[^"]*"/g, "") : chapter.html;
    const { title: chapterTitle, content } = fields(i, {
      title: chapter.title.trim().slice(0, 200),
      content: html ? stampBlockIds(html) : "",
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
