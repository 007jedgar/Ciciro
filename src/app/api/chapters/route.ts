import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// POST /api/chapters — add a chapter to a project (appended to the end).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const projectId: string | undefined = body.projectId;
  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }
  const count = await prisma.chapter.count({ where: { projectId } });
  const chapter = await prisma.chapter.create({
    data: {
      projectId,
      title: body.title?.trim() || `Chapter ${count + 1}`,
      order: count,
    },
  });
  return NextResponse.json(chapter, { status: 201 });
}
