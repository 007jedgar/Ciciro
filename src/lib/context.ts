import { prisma } from "@/lib/db";
import { htmlToText } from "@/lib/text";
import { listBible, readBibleFile, ensureBible } from "@/lib/bible";

// The always-on context for the editor. Kept deliberately small and stable so it
// can be prompt-cached and never bloats:
//   - Tier 1 (sacred, always loaded): canon.md, plot.md, style.md.
//   - Tier 2 (index): every other bible file + every chapter, as one-liners.
//   - A tail snippet of the open chapter, or its full text when the task's
//     scope says it needs it.
// Everything else (full chapters, character files, world/timeline, archived
// chat) the editor pulls on demand with its tools - read_chapter, read_bible,
// search_manuscript, read_blob, read_past_turn, search_chat. Chat history is
// stubbed the same way: index cheaply, expand only when the editor asks.

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
      "To rearrange existing passages - including across chapters - use move_text.",
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

  // Chapter index + the open chapter (tail, or full text if scope needs it).
  parts.push("\n# CHAPTERS (read_chapter <n> for full text)");
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
    const fullText = htmlToText(active.content) || "(empty)";
    // Most tasks (a quick question, a selection-scoped edit, a book-wide
    // sweep) don't need the whole chapter - just enough to see where things
    // stand. Only send it in full when the task's scope says it operates on
    // the chapter as a whole; otherwise give the editor the chapter's own
    // beat summary, what it's still building toward, and a tail for
    // immediate continuity - it can read_chapter for the rest.
    if (scope === "chapter") {
      parts.push(`\n# OPEN CHAPTER: ${active.title}\n${fullText}`);
    } else {
      const openPlotPoints = await prisma.plotPoint.findMany({
        where: { chapterId: active.id, status: "open" },
        orderBy: { order: "asc" },
      });
      const tail =
        fullText.length > TAIL_CHARS ? fullText.slice(-TAIL_CHARS) : fullText;
      const block = [
        `\n# OPEN CHAPTER: ${active.title} (summary + last ${tail.length} chars - read_chapter for the full text)`,
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
