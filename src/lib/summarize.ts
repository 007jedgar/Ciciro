import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { getAnthropic, DRAFTER_FAST_MODEL } from "@/lib/anthropic";
import { htmlToText } from "@/lib/text";
import { SUMMARIZER_SYSTEM } from "@/lib/prompts";

const MIN_CHARS = 200; // not worth summarizing a near-empty chapter
const COOLDOWN_MS = 20_000; // don't re-summarize on every autosave in a typing burst

const lastTriggered = new Map<string, number>();

// Regenerate a chapter's beat summary with Haiku after its content is saved.
// This is continuity bookkeeping, not creative judgment, so the cheap/fast
// model is the right fit - see the editor/drafter split in lib/anthropic.ts.
export async function summarizeChapter(chapterId: string): Promise<void> {
  const now = Date.now();
  const last = lastTriggered.get(chapterId) ?? 0;
  if (now - last < COOLDOWN_MS) return;
  lastTriggered.set(chapterId, now);

  const chapter = await prisma.chapter.findUnique({ where: { id: chapterId } });
  if (!chapter) return;

  const text = htmlToText(chapter.content).trim();
  if (text.length < MIN_CHARS) {
    if (chapter.summary) {
      await prisma.chapter.update({ where: { id: chapterId }, data: { summary: "" } });
    }
    return;
  }

  const anthropic = getAnthropic();
  const res = await anthropic.messages.create({
    model: DRAFTER_FAST_MODEL,
    max_tokens: 200,
    system: SUMMARIZER_SYSTEM,
    messages: [{ role: "user", content: text }],
  });
  const summary = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  if (summary) {
    await prisma.chapter.update({ where: { id: chapterId }, data: { summary } });
  }
}
