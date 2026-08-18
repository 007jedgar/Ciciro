import { prisma } from "@/lib/db";
import { runContinuityCompact } from "@/lib/fast-lane";
import { backstageLine } from "@/lib/backstage";

// Soft budgets for the editor's chat window. Characters are a cheap stand-in
// for tokens (~4 chars/token). When either threshold trips we roll older turns
// into one durable summary so the model keeps continuity without a 40-message
// silent truncation cliff. Rolled rows are archived (not deleted) so
// read_past_turn / search_chat can still retrieve them.
export const KEEP_RECENT = 14;
export const COMPACT_CHAR_BUDGET = 48_000;
export const COMPACT_MESSAGE_BUDGET = 32;

export type CompactResult =
  | { compacted: false }
  | { compacted: true; removed: number; summaryId: string; statusLine: string };

function estimateChars(
  messages: { role: string; content: string }[]
): number {
  return messages.reduce((n, m) => n + m.content.length + 16, 0);
}

function needsCompact(
  messages: { role: string; content: string }[]
): boolean {
  if (messages.length <= KEEP_RECENT + 2) return false;
  if (messages.length > COMPACT_MESSAGE_BUDGET) return true;
  return estimateChars(messages) > COMPACT_CHAR_BUDGET;
}

/**
 * If the project's live chat history is too large for a clean model window,
 * summarize everything before the recent tail into a single compact message
 * and soft-archive the rolled-up rows. Safe to call on every turn - no-ops
 * when under budget.
 *
 * Manuscript addresses are not in this summary. The next turn rebuilds
 * editor context from disk, including the open chapter's passage index
 * (chN.sK / chN.pA) - the analog of re-reading recently touched files.
 */
export async function maybeCompactChat(
  projectId: string,
  force = false
): Promise<CompactResult> {
  const all = await prisma.chatMessage.findMany({
    where: { projectId, archivedAt: null },
    orderBy: { createdAt: "asc" },
  });

  if (!force && !needsCompact(all)) return { compacted: false };
  if (all.length <= KEEP_RECENT) return { compacted: false };

  // Prefer cutting on a user-message boundary so the kept tail still
  // alternates cleanly for the API.
  let cut = all.length - KEEP_RECENT;
  while (cut < all.length && all[cut].role !== "user") cut++;
  if (cut <= 0 || cut >= all.length) {
    cut = Math.max(1, all.length - KEEP_RECENT);
  }

  const older = all.slice(0, cut);
  const newer = all.slice(cut);
  if (!older.length) return { compacted: false };

  // Fold any prior compact summaries into the transcript we re-summarize.
  const transcript = older
    .map((m) => {
      const label =
        m.kind === "compact"
          ? "PRIOR SUMMARY"
          : m.role === "user"
            ? "Author"
            : "Ciciro";
      return `${label}:\n${m.content}`;
    })
    .join("\n\n---\n\n");

  let summaryText: string;
  try {
    summaryText = await runContinuityCompact(transcript);
  } catch {
    // If the summarizer itself is unreachable, fall back to a lossless but
    // truncated stitch so we still shrink the window.
    summaryText = older
      .map((m) => `${m.role}: ${m.content.slice(0, 400)}`)
      .join("\n")
      .slice(0, 6000);
  }

  if (!summaryText) return { compacted: false };

  const content =
    "[Compacted earlier conversation - retain continuity from this summary. " +
    "Details not listed here may still live in the story bible or archived chat " +
    "(read_past_turn / search_chat). Passage addresses (chN.sK / chN.pA) live on " +
    "the manuscript - use the OPEN CHAPTER index in context, or list_passages.]\n\n" +
    summaryText;

  const created = await prisma.$transaction(async (tx) => {
    const now = new Date();
    await tx.chatMessage.updateMany({
      where: { id: { in: older.map((m) => m.id) } },
      data: { status: "archived", archivedAt: now },
    });
    // Anchor the summary just before the kept tail chronologically.
    const anchor = newer[0]?.createdAt ?? new Date();
    return tx.chatMessage.create({
      data: {
        projectId,
        role: "user",
        content,
        kind: "compact",
        status: "compact",
        createdAt: new Date(anchor.getTime() - 1),
      },
    });
  });

  return {
    compacted: true,
    removed: older.length,
    summaryId: created.id,
    statusLine: backstageLine("compact"),
  };
}
