import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { authorizeProject } from "@/lib/auth/session";
import { responseFromAuthError } from "@/lib/auth/http";
import { MAX_AI_INVOLVEMENT_DELTA } from "@/lib/chapters";

export const runtime = "nodejs";

// POST /api/chat/insertions — record that a draft segment was inserted.
// Body: { projectId, turnId, segmentIndex, chapterId, wordCount? }. wordCount,
// when given, is added once to the chapter's AI-involvement tally (see
// src/lib/text.ts) - only by the request that creates the row, never on a
// retry of the same (turnId, segmentIndex). The response then carries the
// chapter's new aiDraftedWords so the client can show it without a reload.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { projectId, turnId, segmentIndex, chapterId, wordCount } = body as {
    projectId?: string;
    turnId?: string;
    segmentIndex?: number;
    chapterId?: string;
    wordCount?: number;
  };

  if (
    !projectId ||
    !turnId?.trim() ||
    !chapterId ||
    typeof segmentIndex !== "number" ||
    segmentIndex < 0
  ) {
    return json(
      { error: "projectId, turnId, segmentIndex, and chapterId required" },
      400
    );
  }

  try {
    await authorizeProject(projectId, req);
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }

  const chapter = await prisma.chapter.findFirst({
    where: { id: chapterId, projectId },
    select: { id: true },
  });
  if (!chapter) return json({ error: "chapter not found" }, 404);

  const key = { turnId_segmentIndex: { turnId: turnId.trim(), segmentIndex } };
  const created = await prisma.draftInsertion
    .create({ data: { projectId, turnId: turnId.trim(), segmentIndex, chapterId } })
    .catch((error: unknown) => {
      if ((error as { code?: unknown }).code === "P2002") return null;
      throw error;
    });
  if (!created) {
    const row = await prisma.draftInsertion.update({ where: key, data: { chapterId } });
    return json(row, 200);
  }

  let aiDraftedWords: number | undefined;
  if (typeof wordCount === "number" && Number.isFinite(wordCount) && wordCount > 0) {
    // Ownership of chapterId is already established above (it must belong to
    // the authorized projectId), so this skips the redundant per-chapter auth
    // check that recordAiInvolvement would otherwise do.
    const words = Math.min(Math.floor(wordCount), MAX_AI_INVOLVEMENT_DELTA);
    aiDraftedWords = await prisma.chapter
      .update({
        where: { id: chapterId },
        data: { aiDraftedWords: { increment: words } },
        select: { aiDraftedWords: true },
      })
      .then((chapter) => chapter.aiDraftedWords)
      .catch(() => undefined);
  }

  return json(aiDraftedWords != null ? { ...created, aiDraftedWords } : created, 200);
}

// GET /api/chat/insertions?projectId=... — list durable draft insertions.
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return json({ error: "projectId required" }, 400);
  try {
    await authorizeProject(projectId, req);
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }

  const insertions = await prisma.draftInsertion.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
  });
  return json(insertions, 200);
}

function json(obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}
