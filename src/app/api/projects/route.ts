import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// GET /api/projects — list all projects (most recent first).
export async function GET() {
  const projects = await prisma.project.findMany({
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { chapters: true } } },
  });
  return NextResponse.json(projects);
}

// POST /api/projects — create a project with an opening chapter.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const project = await prisma.project.create({
    data: {
      title: body.title?.trim() || "Untitled Manuscript",
      author: body.author?.trim() || "",
      genre: body.genre?.trim() || "",
      logline: body.logline?.trim() || "",
      chapters: {
        create: [{ title: "Chapter 1", order: 0 }],
      },
    },
    include: { chapters: true },
  });
  return NextResponse.json(project, { status: 201 });
}
