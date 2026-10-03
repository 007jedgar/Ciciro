import { prisma } from "@/lib/db";
import { chapterPlainText, htmlToText } from "@/lib/text";
import { chapterHtmlForModel, pendingSuggestionsNote } from "@/lib/suggestion-edits";
import { KIND_INFO, normalizeKind } from "@/lib/manuscript-kind";
import { listBible, readBibleFile, ensureBible } from "@/lib/bible";
import { relevantCharacterPaths } from "@/lib/continuity-view";
import { whoKnowsWhatBlock } from "@/lib/knowledge";
import { visibleChaptersInclude } from "@/lib/chapters";
import {
  compactOpenChapterIndex,
  formatSceneIndex,
  indexChapter,
  renderAnnotatedChapter,
} from "@/lib/passages";

// The always-on context for the editor. Kept deliberately small and stable so it
// can be prompt-cached and never bloats:
//   - Tier 1 (sacred, always loaded): canon.md, plot.md, style.md.
//   - Tier 2 (index): every other bible file + every chapter, as one-liners.
//   - Open chapter: passage index (chN.sK / chN.pA) + a tail snippet, or the
//     scene-annotated full text when scope is "chapter".
// Everything else the editor pulls on demand - read_chapter, list_passages,
// read_bible, search_manuscript, read_blob, read_past_turn, search_chat.
// After chat compact, this function runs again on the next turn and re-injects
// the open chapter's passage index from disk (the analog of Claude Code
// re-reading recently touched files). The prose is not dumped back in.

const ALWAYS_ON = ["canon.md", "plot.md", "style.md"];
const TAIL_CHARS = 500;

export async function buildEditorContext(
  projectId: string,
  activeChapterId?: string | null,
  scope?: "selection" | "chapter" | "book",
  autoMode?: boolean,
  namedChapterNumbers: number[] = []
): Promise<string> {
  await ensureBible(projectId);

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      chapters: visibleChaptersInclude,
      openQuestions: { where: { status: "open" }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!project) return "No project found.";

  const parts: string[] = [];
  parts.push(`# ${project.title}${project.author ? ` - ${project.author}` : ""}`);
  const kind = normalizeKind(project.kind);
  if (kind !== "novel") {
    parts.push(
      `Type: ${KIND_INFO[kind].label} (each ${KIND_INFO[kind].unit.toLowerCase()} is one chapter in the tools)`
    );
    if (kind === "blog" && project.logline) parts.push(`Subtitle: ${project.logline}`);
  }
  if (project.genre) parts.push(`Genre: ${project.genre}`);

  if (autoMode) {
    parts.push(
      "\n# AUTO MODE ON",
      "Finished <draft> blocks insert automatically into the OPEN chapter (at the cursor, or stacked after prior inserts from this turn).",
      "Before drafting for a different chapter, call open_chapter or create_chapter (with open: true).",
      "To place prose at a precise spot (not the cursor), use insert_text with after/before/position instead of a <draft>.",
      "To rearrange existing passages - including across chapters - use move_text with passage ids (chN.sK), not quoted prose.",
      "When the story needs a new chapter break, call create_chapter; do not ask the author to click Add."
    );
  }

  // Standing questions the editor answered provisionally. Keep these in view so it
  // stays consistent with its own choices and can reconcile when one is answered.
  if (project.openQuestions.length) {
    parts.push("\n# OPEN QUESTIONS (provisional - keep consistent; reconcile when answered)");
    for (const q of project.openQuestions) {
      parts.push(
        `- [${q.id}] ${q.question} -> went with: ${q.provisional || "n/a"}${
          q.affects ? ` (affects: ${q.affects})` : ""
        }`
      );
    }
  }

  // Tier 1: the sacred files, in full.
  parts.push("\n# BIBLE (always in view)");
  for (const name of ALWAYS_ON) {
    const text = (await readBibleFile(projectId, name)).trim();
    if (text) parts.push(`\n<<< ${name} >>>\n${text}`);
  }

  // Tier 2: index of everything else the editor can open on demand.
  const entries = await listBible(projectId);
  const others = entries.filter((e) => !ALWAYS_ON.includes(e.path));
  if (others.length) {
    parts.push("\n# BIBLE INDEX (read_bible <path> to open)");
    for (const e of others) parts.push(`- ${e.path}: ${e.summary}`);
  }

  // Chapter index + the open chapter (passage ids + tail, or annotated full
  // text if scope needs it). Rebuilt every turn, including after compact.
  parts.push("\n# CHAPTERS (list_passages <n> for ids; read_chapter <n> for annotated text)");
  if (!project.chapters.length) parts.push("(none yet)");
  for (let i = 0; i < project.chapters.length; i++) {
    const ch = project.chapters[i];
    const active = ch.id === activeChapterId;
    parts.push(
      `- ${i + 1}. ${ch.title} (${ch.wordCount} words, ${ch.status})${
        ch.summary ? ` - ${ch.summary}` : ""
      }${active ? "  <-- OPEN" : ""}`
    );
  }

  const namedNumbers = [...new Set(namedChapterNumbers)].filter(
    (number) => Number.isInteger(number) && number > 0
  );
  const namedChapters = namedNumbers
    .map((number) => project.chapters[number - 1])
    .filter((chapter): chapter is (typeof project.chapters)[number] => Boolean(chapter));

  const active = project.chapters.find((c) => c.id === activeChapterId);

  // Only the active chapter and any named chapters need prose; the index
  // above only reads title/order/wordCount/status/summary. One targeted
  // query instead of pulling every visible chapter's `content`.
  const contentIds = new Set<string>();
  if (active) contentIds.add(active.id);
  for (const chapter of namedChapters) {
    if (chapter.id !== activeChapterId) contentIds.add(chapter.id);
  }
  const contentRows = contentIds.size
    ? await prisma.chapter.findMany({
        where: { id: { in: [...contentIds] } },
        select: { id: true, content: true },
      })
    : [];
  const contentById = new Map(contentRows.map((row) => [row.id, row.content]));

  for (const chapterNumber of namedNumbers) {
    const chapter = project.chapters[chapterNumber - 1];
    if (!chapter || chapter.id === activeChapterId) continue;
    parts.push(
      `\n# NAMED CHAPTER ${chapterNumber}: ${chapter.title} (passage index)`,
      formatSceneIndex(indexChapter(contentById.get(chapter.id) ?? "", chapterNumber), {
        paragraphs: true,
        paraCap: 24,
      })
    );
  }

  if (active) {
    const activeContent = contentById.get(active.id) ?? "";
    const chapterNumber = project.chapters.indexOf(active) + 1;
    const fullText = htmlToText(chapterHtmlForModel(activeContent)) || "(empty)";
    const passageIndex = compactOpenChapterIndex(activeContent, chapterNumber);
    // Most tasks don't need the whole chapter. Always send the passage index
    // so the editor can move by id after compact without re-quoting prose.
    // Only send annotated full text when the task's scope is the chapter.
    if (scope === "chapter") {
      parts.push(
        `\n# OPEN CHAPTER: ${active.title} (passages: ch${chapterNumber}.sK / ch${chapterNumber}.pA)`,
        passageIndex,
        "",
        pendingSuggestionsNote(activeContent) +
          renderAnnotatedChapter(chapterHtmlForModel(activeContent), chapterNumber)
      );
    } else {
      const openPlotPoints = await prisma.plotPoint.findMany({
        where: { chapterId: active.id, status: "open" },
        orderBy: { order: "asc" },
      });
      const tail =
        fullText.length > TAIL_CHARS ? fullText.slice(-TAIL_CHARS) : fullText;
      const block = [
        `\n# OPEN CHAPTER: ${active.title} (passage index + last ${tail.length} chars - list_passages / read_chapter for more)`,
        passageIndex,
      ];
      if (openPlotPoints.length) {
        block.push(
          "Motivation (open plot points):",
          ...openPlotPoints.map(
            (p) => `- [${p.type}] ${p.title}${p.description ? ` - ${p.description}` : ""}`
          )
        );
      }
      block.push(
        `\nSummary so far: ${active.summary.trim() || "(none recorded yet)"}`,
        `\n${pendingSuggestionsNote(activeContent)}...${tail}`
      );
      parts.push(block.join("\n"));
    }

    const namedHere = relevantCharacterPaths(entries, chapterPlainText(activeContent));
    const whoKnows = await whoKnowsWhatBlock(projectId, namedHere);
    if (whoKnows) parts.push(`\n${whoKnows}`);
  }

  return parts.join("\n");
}
