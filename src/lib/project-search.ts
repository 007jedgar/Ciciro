import { prisma } from "@/lib/db";
import { writeChapterHtml } from "@/lib/chapter-writes";
import { htmlToDoc, docToHtml } from "@/lib/manuscript";
import {
  normalizeQuery,
  replaceInBlockHtml,
  searchBlockHtml,
  snippetAround,
  type SearchOptions,
} from "@/lib/manuscript-search";
import type { PublicUser } from "@/lib/auth/session";
import { authorizeOwnedProject } from "@/lib/auth/access";
import { AuthError } from "@/lib/auth/session";
import { countWords, htmlToText } from "@/lib/text";

// Manuscript-wide search and find-and-replace. Replacements are chapter writes
// like any other: block ops appended to the chapter's log under the caller as
// `user`, so the head, the sync poke and every replica move the way they do for
// a typed edit.

export const MAX_SEARCH_MATCHES = 500;
const WRITE_ATTEMPTS = 3;

export type SearchMatch = {
  chapterId: string;
  chapterTitle: string;
  /** 1-based position among the manuscript's live chapters. */
  chapterNumber: number;
  blockId: string;
  /** Which of the block's matches this is; with `blockId` it addresses one match. */
  occurrence: number;
  /** Offset of the match in the block's visible text (the editor caret offset). */
  offset: number;
  before: string;
  match: string;
  after: string;
};

export type SearchResult = {
  matches: SearchMatch[];
  /** Every match in the manuscript, including any beyond the returned page. */
  total: number;
  truncated: boolean;
  chapters: number;
};

export type ReplaceTarget = { chapterId: string; blockId: string; occurrence: number };

export type ReplaceRequest = SearchOptions & {
  query: string;
  replacement: string;
  /** One match. Absent means every match in the manuscript. */
  target?: ReplaceTarget;
};

export type ReplacedChapter = {
  id: string;
  content: string;
  revision: number;
  wordCount: number;
  replaced: number;
};

export type ReplaceResult = { replaced: number; chapters: ReplacedChapter[] };

async function liveChapters(projectId: string) {
  return prisma.chapter.findMany({
    where: { projectId, archivedAt: null },
    orderBy: { order: "asc" },
    select: { id: true, title: true, content: true, revision: true, projectId: true },
  });
}

export async function searchProject(
  projectId: string,
  user: PublicUser | null,
  query: string,
  options: SearchOptions
): Promise<SearchResult> {
  await authorizeOwnedProject(projectId, user);
  if (!normalizeQuery(query)) return { matches: [], total: 0, truncated: false, chapters: 0 };
  const chapters = await liveChapters(projectId);
  const matches: SearchMatch[] = [];
  let total = 0;
  const hit = new Set<string>();
  chapters.forEach((chapter, i) => {
    for (const block of htmlToDoc(chapter.content, chapter.revision).doc.blocks) {
      if (block.kind === "scene_break") continue;
      const found = searchBlockHtml(block.html, query, options);
      found.matches.forEach((m, occurrence) => {
        total += 1;
        hit.add(chapter.id);
        if (matches.length >= MAX_SEARCH_MATCHES) return;
        matches.push({
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          chapterNumber: i + 1,
          blockId: block.id,
          occurrence,
          offset: m.start,
          ...snippetAround(found.text, m),
        });
      });
    }
  });
  return { matches, total, truncated: total > matches.length, chapters: hit.size };
}

/** New chapter HTML with the request applied, or null when nothing matched. */
function applyToChapter(
  content: string,
  revision: number,
  req: ReplaceRequest
): { html: string; replaced: number } | null {
  const doc = htmlToDoc(content, revision).doc;
  let replaced = 0;
  for (const block of doc.blocks) {
    if (block.kind === "scene_break") continue;
    if (req.target && block.id !== req.target.blockId) continue;
    const out = replaceInBlockHtml(
      block.html,
      req.query,
      req.replacement,
      req,
      req.target?.occurrence
    );
    if (out.count === 0) continue;
    block.html = out.html;
    replaced += out.count;
  }
  return replaced === 0 ? null : { html: docToHtml(doc), replaced };
}

export async function replaceInProject(
  projectId: string,
  user: PublicUser | null,
  req: ReplaceRequest
): Promise<ReplaceResult> {
  await authorizeOwnedProject(projectId, user);
  if (!normalizeQuery(req.query)) throw new AuthError("Enter something to find.", 400);
  if (/[\r\n]/.test(req.replacement) || req.replacement.length > 2000) {
    throw new AuthError("The replacement must be a single line.", 400);
  }

  const scope = req.target
    ? await prisma.chapter.findMany({
        where: { id: req.target.chapterId, projectId, archivedAt: null },
        select: { id: true },
      })
    : await prisma.chapter.findMany({
        where: { projectId, archivedAt: null },
        orderBy: { order: "asc" },
        select: { id: true },
      });
  if (req.target && scope.length === 0) throw new AuthError("Not found.", 404);

  const chapters: ReplacedChapter[] = [];
  for (const { id } of scope) {
    // A keystroke can move the head between reading it and committing; the
    // group is then rejected whole, so re-read and try again.
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
      const head = await prisma.chapter.findUnique({
        where: { id },
        select: { id: true, projectId: true, content: true, revision: true },
      });
      if (!head) break;
      const next = applyToChapter(head.content, head.revision, req);
      if (!next) break;
      const written = await writeChapterHtml(head, next.html, { actor: "user" });
      if (!written.ok) continue;
      chapters.push({
        id,
        content: written.content,
        revision: written.revision,
        wordCount: countWords(htmlToText(written.content)),
        replaced: next.replaced,
      });
      break;
    }
  }
  if (req.target && chapters.length === 0) {
    throw new AuthError("That match has changed. Search again.", 409);
  }
  return { replaced: chapters.reduce((n, c) => n + c.replaced, 0), chapters };
}
