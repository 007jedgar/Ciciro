import { prisma } from "@/lib/db";

/**
 * Reading, clearing and un-clearing a manuscript's conversation.
 *
 * Clearing is an archive, not a delete. The author is told the chat is gone and
 * for every purpose it is — nothing archived is read back, summarised, or sent
 * to the editor — but the rows survive long enough for an Undo to mean
 * something. `compact` already archives this way; this brings Clear in line.
 */

const MAX_ROWS = 200;

const RUN_FIELDS = {
  id: true,
  projectId: true,
  turnId: true,
  userMessageId: true,
  assistantMessageId: true,
  kind: true,
  scope: true,
  activeChapterId: true,
  selection: true,
  autoMode: true,
  status: true,
  visibleOutput: true,
  iterationCount: true,
  mutationCount: true,
  stopReason: true,
  verificationJson: true,
  error: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * The chat plus the durable runs behind it.
 *
 * Runs are scoped to turns that still have a live message. A run carries its
 * own `visibleOutput`, and the client fills empty assistant rows from it — so
 * shipping the run of an archived turn would put the cleared reply straight
 * back on screen.
 */
export async function loadChatSnapshot(projectId: string) {
  const messages = await prisma.chatMessage.findMany({
    where: { projectId, archivedAt: null },
    orderBy: { createdAt: "asc" },
    take: MAX_ROWS,
  });
  const turnIds = [
    ...new Set(messages.map((message) => message.turnId).filter((id): id is string => Boolean(id))),
  ];
  const runs = turnIds.length
    ? await prisma.editorRun.findMany({
        where: { projectId, turnId: { in: turnIds } },
        orderBy: { createdAt: "asc" },
        take: MAX_ROWS,
        select: RUN_FIELDS,
      })
    : [];
  return { messages, runs };
}

export type ChatArchiveResult = {
  ok: true;
  /** The stamp this batch was archived under — the handle Undo restores by. */
  archivedAt: string | null;
  count: number;
};

/**
 * Clear the conversation. Every message still on screen is stamped with one
 * shared timestamp, so a later restore can lift exactly this batch and leave
 * anything `compact` archived earlier where it is.
 */
export async function archiveChat(projectId: string): Promise<ChatArchiveResult> {
  const archivedAt = new Date();
  const { count } = await prisma.chatMessage.updateMany({
    where: { projectId, archivedAt: null },
    data: { archivedAt },
  });
  return {
    ok: true,
    archivedAt: count > 0 ? archivedAt.toISOString() : null,
    count,
  };
}

/** Undo one clear, named by the stamp `archiveChat` returned. */
export async function restoreChat(
  projectId: string,
  archivedAt: string
): Promise<{ ok: true; count: number }> {
  const stamp = new Date(archivedAt);
  if (Number.isNaN(stamp.getTime())) {
    return { ok: true, count: 0 };
  }
  const { count } = await prisma.chatMessage.updateMany({
    where: { projectId, archivedAt: stamp },
    data: { archivedAt: null },
  });
  return { ok: true, count };
}
