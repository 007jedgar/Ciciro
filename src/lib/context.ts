import { prisma } from "@/lib/db";
import { htmlToText } from "@/lib/text";
import { listBible, readBibleFile, ensureBible } from "@/lib/bible";
import {
  compactOpenChapterIndex,
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
  autoMode?: boolean
): Promise<string> {
  await ensureBible(projectId);

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      chapters: { orderBy: { order: "asc" } },
      openQuestions: { where: { status: "open" }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!project) return "No project found.";

  const parts: string[] = [];
  parts.push(`# ${project.title}${project.author ? ` - ${project.author}` : ""}`);
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

  const active = project.chapters.find((c) => c.id === activeChapterId);
  if (active) {
    const chapterNumber = project.chapters.indexOf(active) + 1;
    const fullText = htmlToText(active.content) || "(empty)";
    const passageIndex = compactOpenChapterIndex(active.content, chapterNumber);
    // Most tasks don't need the whole chapter. Always send the passage index
    // so the editor can move by id after compact without re-quoting prose.
    // Only send annotated full text when the task's scope is the chapter.
    if (scope === "chapter") {
      parts.push(
        `\n# OPEN CHAPTER: ${active.title} (passages: ch${chapterNumber}.sK / ch${chapterNumber}.pA)`,
        passageIndex,
        "",
        renderAnnotatedChapter(active.content, chapterNumber)
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
        `\n...${tail}`
      );
      parts.push(block.join("\n"));
    }
  }

  return parts.join("\n");
}
