import { htmlToDoc } from "@/lib/manuscript";
import { clampBlockOffset } from "@/lib/reading-caret";
import { lastSentencesBefore } from "@/lib/reminder-nudge-text";

export { composeSceneReminderBody, lastSentencesBefore } from "@/lib/reminder-nudge-text";

/** Plain text ending at the reading caret, then the last one or two sentences. */
export function excerptAtReadingPosition(
  html: string,
  blockId: string,
  offset: number
): string | null {
  const { doc } = htmlToDoc(html, 0);
  let plain = "";
  let found = false;
  for (let i = 0; i < doc.blocks.length; i++) {
    const block = doc.blocks[i]!;
    if (i > 0) plain += "\n\n";
    if (block.id === blockId) {
      plain += block.text.slice(0, clampBlockOffset(block.text, offset));
      found = true;
      break;
    }
    plain += block.text;
  }
  if (!found) return null;
  const excerpt = lastSentencesBefore(plain, plain.length, 2);
  return excerpt || null;
}

export function buildReminderNudgePrompt(excerpt: string, title: string): string {
  return [
    "You are Ciciro, a warm writing companion.",
    "The author left off here in their manuscript.",
    "Reply with ONE short line (under 20 words) that nudges them back into the scene.",
    "No quotes around the line. No preamble. Second person or character name is fine.",
    `Manuscript: ${title}`,
    "Excerpt:",
    excerpt,
  ].join("\n");
}
