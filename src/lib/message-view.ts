import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { getAnthropic, DRAFTER_FAST_MODEL } from "@/lib/anthropic";
import { joinSegments, parseSegments } from "@/lib/segments";
import { countWords } from "@/lib/text";

// Model-facing chat history: keep author-visible ChatMessage.content intact,
// but send stubs for inserted drafts and aged/oversized payloads.
//
// Resume note: mid-turn tool_use/tool_result pairs live only in the in-memory
// messages array for the active request. We never regenerate those stubs on
// resume - resume rebuilds from persisted ChatMessage rows + the partial
// assistant seed (existing heal.ts path). Stubbing archived history or
// inserted drafts does not rewrite tool pairings inside a live loop.

export const KEEP_RECENT_FULL = 8;
export const OVERSIZE_CHARS = 1_200;
export const SELECTION_CAP = 2_000;

type MsgRow = {
  id: string;
  role: string;
  content: string;
  modelContent: string | null;
  kind: string;
  turnId: string | null;
  status: string;
  createdAt: Date;
};

export type InsertionRef = {
  turnId: string;
  segmentIndex: number;
  chapterId: string;
  chapterTitle?: string;
  chapterNumber?: number;
};

function draftStub(ins: InsertionRef): string {
  const where =
    ins.chapterNumber != null
      ? `Chapter ${ins.chapterNumber}${ins.chapterTitle ? ` ("${ins.chapterTitle}")` : ""}`
      : "the manuscript";
  return `[draft inserted into ${where} - see manuscript via read_chapter]`;
}

/**
 * Replace inserted <draft> segments with plain one-line pointers (not draft
 * tags). A segment can be genuinely still-open in raw storage (e.g. inserted
 * from a `status: "partial"` message before it's been resumed/closed) - an
 * explicit DraftInsertion record is a stronger signal than the open/closed
 * heuristic, so it's honored either way. Segments with no insertion record
 * keep the open-check, since those are still mid-stream, not yet inserted.
 */
export function stubInsertedDrafts(
  content: string,
  insertions: Map<number, InsertionRef>
): string {
  if (!insertions.size) return content;
  const segs = parseSegments(content);
  let changed = false;
  const next = segs.map((seg, idx) => {
    if (seg.kind !== "draft") return seg;
    const ins = insertions.get(idx);
    if (!ins) return seg;
    changed = true;
    return { kind: "md" as const, text: `\n${draftStub(ins)}\n` };
  });
  return changed ? joinSegments(next) : content;
}

function oneLineGist(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return flat.slice(0, max - 1) + "…";
}

/**
 * Build Anthropic message params from live (non-archived) history.
 * Inserted drafts are always stubbed. Outside the recent window, prefer
 * cached modelContent when present.
 */
export async function toModelMessages(
  projectId: string,
  rows: MsgRow[],
  opts?: { keepRecent?: number }
): Promise<Anthropic.MessageParam[]> {
  const keepRecent = opts?.keepRecent ?? KEEP_RECENT_FULL;
  const turnIds = [
    ...new Set(rows.map((r) => r.turnId).filter((t): t is string => Boolean(t))),
  ];

  const insertions = turnIds.length
    ? await prisma.draftInsertion.findMany({ where: { projectId, turnId: { in: turnIds } } })
    : [];

  const chapterIds = [...new Set(insertions.map((i) => i.chapterId))];
  const chapters = chapterIds.length
    ? await prisma.chapter.findMany({
        where: { projectId, id: { in: chapterIds } },
        select: { id: true, title: true, order: true },
      })
    : [];
  const chapterById = new Map(
    chapters.map((c) => [
      c.id,
      { title: c.title, number: c.order + 1 },
    ])
  );

  const byTurn = new Map<string, Map<number, InsertionRef>>();
  for (const ins of insertions) {
    const meta = chapterById.get(ins.chapterId);
    const ref: InsertionRef = {
      turnId: ins.turnId,
      segmentIndex: ins.segmentIndex,
      chapterId: ins.chapterId,
      chapterTitle: meta?.title,
      chapterNumber: meta?.number,
    };
    let m = byTurn.get(ins.turnId);
    if (!m) {
      m = new Map();
      byTurn.set(ins.turnId, m);
    }
    m.set(ins.segmentIndex, ref);
  }

  const cut = Math.max(0, rows.length - keepRecent);

  return rows.map((m, i) => {
    const insMap = m.turnId ? byTurn.get(m.turnId) : undefined;
    const aged = i < cut;
    let body =
      aged && m.modelContent
        ? m.modelContent
        : m.content;

    if (insMap?.size) {
      body = stubInsertedDrafts(body, insMap);
      // If we were using full content and still have huge uninserted drafts in
      // the recent window, leave them - Opus may still revise. Aged messages
      // without modelContent get a hard trim below.
    }

    if (aged && !m.modelContent && body.length > OVERSIZE_CHARS) {
      body =
        `[earlier ${m.role} message id:${m.id} - ${oneLineGist(m.content)}]\n` +
        `(full text via read_past_turn id="${m.id}")`;
    }

    return {
      role: m.role as "user" | "assistant",
      content: body,
    };
  });
}

/**
 * Persist a ChatBlob and return a stub string for the model history.
 * Used for oversized tool results mid-turn and write-time excerpts.
 */
export async function archiveAsBlob(opts: {
  projectId: string;
  kind: "tool_result" | "chat_excerpt" | "transcript";
  content: string;
  label?: string;
  messageId?: string;
  turnId?: string;
}): Promise<{ blobId: string; stub: string }> {
  const label = opts.label || oneLineGist(opts.content);
  const blob = await prisma.chatBlob.create({
    data: {
      projectId: opts.projectId,
      kind: opts.kind,
      content: opts.content,
      charCount: opts.content.length,
      label,
      messageId: opts.messageId,
      turnId: opts.turnId,
    },
  });
  const words = countWords(opts.content);
  const stub =
    `[${opts.kind} ref:${blob.id} ~${words} words - "${label}"]\n` +
    `(full text via read_blob id="${blob.id}")`;
  return { blobId: blob.id, stub };
}

/**
 * After an assistant/user message is persisted, cache a model-facing stub if
 * the content is oversized. Mirrors summarize.ts: fire-and-forget, once.
 */
export async function ensureModelContent(messageId: string): Promise<void> {
  const msg = await prisma.chatMessage.findUnique({ where: { id: messageId } });
  if (!msg || msg.modelContent || msg.kind === "compact") return;
  if (msg.content.length < OVERSIZE_CHARS) return;

  // Don't AI-summarize here for draft-heavy replies - deterministic draft stubs
  // + a short non-draft excerpt are enough and avoid inventing plot facts.
  const segs = parseSegments(msg.content);
  const mdParts = segs
    .filter((s) => s.kind === "md")
    .map((s) => s.text.trim())
    .filter(Boolean);
  const draftCount = segs.filter((s) => s.kind === "draft" && !s.open).length;

  let gist: string;
  try {
    if (mdParts.join("\n").length > 200) {
      const anthropic = getAnthropic();
      const res = await anthropic.messages.create({
        model: DRAFTER_FAST_MODEL,
        max_tokens: 120,
        system:
          "Summarize this chat message for a novel editor AI in one short line. " +
          "Keep decisions and open threads. Drop full prose. No preamble.",
        messages: [{ role: "user", content: mdParts.join("\n\n").slice(0, 6000) }],
      });
      gist = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
    } else {
      gist = oneLineGist(msg.content);
    }
  } catch {
    gist = oneLineGist(msg.content);
  }

  const { stub } = await archiveAsBlob({
    projectId: msg.projectId,
    kind: "chat_excerpt",
    content: msg.content,
    label: gist || oneLineGist(msg.content),
    messageId: msg.id,
    turnId: msg.turnId || undefined,
  });

  const draftNote =
    draftCount > 0
      ? `\n[${draftCount} draft block(s) - inserted ones stub to manuscript; others in blob]`
      : "";

  await prisma.chatMessage.update({
    where: { id: messageId },
    data: { modelContent: stub + draftNote },
  });
}

/** Cap a selection for injection; oversized selections become a blob stub. */
export async function selectionForModel(
  projectId: string,
  selection: string,
  turnId?: string
): Promise<string> {
  const trimmed = selection.trim();
  if (!trimmed) return "";
  if (trimmed.length <= SELECTION_CAP) {
    return `\n\n<selected_text>\n${trimmed}\n</selected_text>`;
  }
  const { stub } = await archiveAsBlob({
    projectId,
    kind: "chat_excerpt",
    content: trimmed,
    label: oneLineGist(trimmed, 80),
    turnId,
  });
  return `\n\n<selected_text stub="true">\n${stub}\n</selected_text>`;
}
