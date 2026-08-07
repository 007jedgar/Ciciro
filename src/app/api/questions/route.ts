import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// GET /api/questions?projectId=...[&status=open] — list open questions.
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  const status = req.nextUrl.searchParams.get("status");
  if (!projectId) return json({ error: "projectId required" }, 400);
  const questions = await prisma.openQuestion.findMany({
    where: { projectId, ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
  });
  return json(questions, 200);
}

// POST /api/questions — create one manually.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!body.projectId || !body.question?.trim()) {
    return json({ error: "projectId and question required" }, 400);
  }
  const q = await prisma.openQuestion.create({
    data: {
      projectId: body.projectId,
      question: body.question.trim(),
      provisional: body.provisional?.trim() || "",
      affects: body.affects?.trim() || "",
      chapterId: body.chapterId || null,
    },
  });
  return json(q, 201);
}

function json(obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}
