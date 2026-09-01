import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";

export const runtime = "nodejs";

// GET /api/projects — list projects (most recent first). When a user is signed
// in, only their manuscripts are returned; local-first (no session) lists all.
export async function GET() {
  const user = await getSessionUser();
  const projects = await prisma.project.findMany({
    where: user ? { userId: user.id } : undefined,
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { chapters: true } } },
  });
  return NextResponse.json(projects);
}

// POST /api/projects — create a project with an opening chapter, owned by the
// signed-in user when there is one.
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  const body = await req.json().catch(() => ({}));
  const project = await prisma.project.create({
    data: {
      userId: user?.id ?? null,
      title: body.title?.trim() || "Untitled Manuscript",
      author: body.author?.trim() || user?.name || "",
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
