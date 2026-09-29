import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { authorizeOwnedProject } from "@/lib/auth/access";
import { AuthError, type PublicUser } from "@/lib/auth/session";
import { DRAFTER_MODEL, getAnthropic, hasAnthropicKey } from "@/lib/anthropic";
import { withAiRun } from "@/lib/entitlements";
import { STYLE_ANALYSIS_SYSTEM } from "@/lib/prompts";
import { ensureBible, getBibleFile, listBibleFiles, type BibleFileRecord } from "@/lib/bible";
import { visibleChapterWhere } from "@/lib/chapters";
import { chapterPlainText, countWords } from "@/lib/text";
import {
  parseStyleAnalysisJson,
  mergeProposedStyleMd,
  type CharacterVoiceProposal,
  type StyleAnalysisProposal,
} from "@/lib/style-analysis-view";

// Bound token cost: sample a handful of chapters spread across the
// manuscript, not the whole book, and cap each chapter's excerpt.
export const MAX_SAMPLE_CHAPTERS = 5;
export const MAX_WORDS_PER_CHAPTER = 1200;
const MIN_TOTAL_WORDS = 200;

export type ChapterForSample = { id: string; title: string; text: string };

/**
 * A deterministic, spread-out sample: first, last, and evenly spaced chapters
 * between them, up to `maxChapters`. Sampling across the manuscript (not just
 * the latest chapter) matters because voice can drift as a book goes on -
 * this reflects the author's overall prose, not just their most recent pass.
 */
export function pickSampleChapters(
  chapters: ChapterForSample[],
  maxChapters: number = MAX_SAMPLE_CHAPTERS
): ChapterForSample[] {
  const withProse = chapters.filter((c) => c.text.trim().length > 0);
  if (withProse.length <= maxChapters) return withProse;

  const n = Math.max(1, maxChapters);
  const seen = new Set<number>();
  const picked: ChapterForSample[] = [];
  for (let i = 0; i < n; i++) {
    const idx = n === 1 ? 0 : Math.round((i * (withProse.length - 1)) / (n - 1));
    if (seen.has(idx)) continue;
    seen.add(idx);
    picked.push(withProse[idx]);
  }
  return picked;
}

/** The first `maxWords` words of `text`, so one long chapter can't blow the budget. */
export function excerptWords(text: string, maxWords: number = MAX_WORDS_PER_CHAPTER): string {
  const trimmed = text.trim();
  const words = trimmed.split(/\s+/);
  if (words.length <= maxWords) return trimmed;
  return words.slice(0, maxWords).join(" ") + " …";
}

function textOf(res: Anthropic.Message): string {
  return res.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

// The bible's character files (characters/<slug>.md) each open with a "# Name"
// title - see emptyCharacterFile in src/lib/bible.ts.
function characterFilesFromBible(
  files: BibleFileRecord[]
): { path: string; name: string; content: string; revision: number }[] {
  const out: { path: string; name: string; content: string; revision: number }[] = [];
  for (const file of files) {
    if (!file.path.startsWith("characters/")) continue;
    const titleLine = file.content.split("\n").find((line) => line.trim().length > 0);
    const name = titleLine?.replace(/^#+\s*/, "").trim();
    if (name) out.push({ path: file.path, name, content: file.content, revision: file.revision });
  }
  return out;
}

/**
 * Draft a proposed style.md and character Voice sections from a sample of the
 * author's own chapters. Read-only: nothing is written to the bible here -
 * the caller (the review UI) saves each accepted piece through the existing
 * bible write path (writeBibleFile / POST /api/bible), one file at a time.
 */
export async function analyzeStyle(
  projectId: string,
  user: PublicUser | null
): Promise<StyleAnalysisProposal> {
  await authorizeOwnedProject(projectId, user);
  if (!hasAnthropicKey()) {
    throw new AuthError("Analyzing style needs an ANTHROPIC_API_KEY.", 503);
  }

  await ensureBible(projectId);
  const [chapters, bibleFiles, styleFile] = await Promise.all([
    prisma.chapter.findMany({
      where: { projectId, ...visibleChapterWhere },
      orderBy: { order: "asc" },
      select: { id: true, title: true, content: true },
    }),
    listBibleFiles(projectId),
    getBibleFile(projectId, "style.md"),
  ]);

  // chapterPlainText reads through htmlWithoutSuggestions, so a pending
  // Ciciro insertion the author hasn't accepted yet is excluded from the
  // sample - only prose the author actually wrote or accepted counts as
  // "their own voice." A pending deletion still counts; it's their words
  // until they accept removing it.
  const withText: ChapterForSample[] = chapters.map((c) => ({
    id: c.id,
    title: c.title,
    text: chapterPlainText(c.content),
  }));
  const totalWords = withText.reduce((sum, c) => sum + countWords(c.text), 0);
  if (totalWords < MIN_TOTAL_WORDS) {
    throw new AuthError("Write a bit more before analyzing style - there isn't enough prose yet.", 400);
  }

  const sample = pickSampleChapters(withText);
  const sampleText = sample
    .map((c) => `## ${c.title || "Untitled"}\n${excerptWords(c.text)}`)
    .join("\n\n");

  const characterFiles = characterFilesFromBible(bibleFiles);
  const characterNames = characterFiles.map((c) => c.name);

  const input = [
    "Manuscript excerpts (sampled, not the whole book):",
    sampleText,
    "",
    `Named characters: ${characterNames.length ? characterNames.join(", ") : "(none yet)"}`,
  ].join("\n");

  const parsed = await withAiRun(user, async () => {
    let text: string;
    try {
      const res = await getAnthropic().messages.create({
        model: DRAFTER_MODEL,
        max_tokens: 2000,
        system: STYLE_ANALYSIS_SYSTEM,
        messages: [{ role: "user", content: input }],
      });
      text = textOf(res);
    } catch {
      throw new AuthError("Couldn't analyze style right now. Try again.", 502);
    }
    const result = parseStyleAnalysisJson(text, { sampleText, characterNames });
    if (!result || result.traits.length === 0) {
      throw new AuthError(
        "Couldn't draft a style proposal from what's written yet. Try again once there's more prose.",
        502
      );
    }
    return result;
  });

  const byName = new Map(characterFiles.map((c) => [c.name.toLowerCase(), c]));
  const characters: CharacterVoiceProposal[] = [];
  for (const c of parsed.characters) {
    const file = byName.get(c.name.toLowerCase());
    if (!file) continue;
    characters.push({
      path: file.path,
      name: file.name,
      voice: c.voice,
      quote: c.quote,
      currentContent: file.content,
      currentRevision: file.revision,
    });
  }

  const currentStyleMd = styleFile?.content ?? "";
  const merged = mergeProposedStyleMd(currentStyleMd, parsed.traits);
  return {
    traits: parsed.traits,
    characters,
    sampledChapters: sample.map((c) => ({ id: c.id, title: c.title })),
    currentStyleMd,
    currentStyleMdRevision: styleFile?.revision ?? 0,
    proposedStyleMd: merged.styleMd,
    draftTraits: merged.added,
    styleSuggestions: merged.suggestions,
  };
}
