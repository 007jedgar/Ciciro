import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// POST /api/chat/insertions — record that a draft segment was inserted.
// Body: { projectId, turnId, segmentIndex, chapterId }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { projectId, turnId, segmentIndex, chapterId } = body as {
    projectId?: string;
    turnId?: string;
    segmentIndex?: number;
    chapterId?: string;
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

  const chapter = await prisma.chapter.findFirst({
    where: { id: chapterId, projectId },
    select: { id: true },
  });
  if (!chapter) return json({ error: "chapter not found" }, 404);

  const row = await prisma.draftInsertion.upsert({
    where: {
      turnId_segmentIndex: {
        turnId: turnId.trim(),
        segmentIndex,
      },
    },
    create: {
      projectId,
      turnId: turnId.trim(),
      segmentIndex,
      chapterId,
    },
    update: { chapterId },
  });

  return json(row, 200);
}

// GET /api/chat/insertions?projectId=... — list durable draft insertions.
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return json({ error: "projectId required" }, 400);

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
