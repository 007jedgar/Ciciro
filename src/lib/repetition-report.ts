import { prisma } from "@/lib/db";
import type { PublicUser } from "@/lib/auth/session";
import { authorizeOwnedProject } from "@/lib/auth/access";
import { listBibleFiles } from "@/lib/bible";
import { chapterPlainText } from "@/lib/text";
import {
  DEFAULT_THRESHOLDS,
  analyzeManuscriptRepetition,
  type ChapterText,
  type ManuscriptRepetitionReport,
} from "@/lib/repetition";

// The bible's character files (characters/<slug>.md) each open with a "# Name"
// title - see emptyCharacterFile in src/lib/bible.ts. That title is the name
// the repetition detector treats the same as a stop word.
function characterNamesFromBible(files: { path: string; content: string }[]): string[] {
  const names: string[] = [];
  for (const file of files) {
    if (!file.path.startsWith("characters/")) continue;
    const titleLine = file.content.split("\n").find((line) => line.trim().length > 0);
    const title = titleLine?.replace(/^#+\s*/, "").trim();
    if (title) names.push(title);
  }
  return names;
}

export async function repetitionReportForProject(
  projectId: string,
  user: PublicUser | null
): Promise<ManuscriptRepetitionReport> {
  await authorizeOwnedProject(projectId, user);
  const [chapters, bibleFiles] = await Promise.all([
    prisma.chapter.findMany({
      where: { projectId, archivedAt: null },
      orderBy: { order: "asc" },
      select: { id: true, title: true, content: true },
    }),
    listBibleFiles(projectId),
  ]);
  const characterNames = characterNamesFromBible(bibleFiles);
  const chapterTexts: ChapterText[] = chapters.map((chapter, i) => ({
    id: chapter.id,
    title: chapter.title,
    number: i + 1,
    text: chapterPlainText(chapter.content),
  }));
  return analyzeManuscriptRepetition(chapterTexts, characterNames, DEFAULT_THRESHOLDS);
}
