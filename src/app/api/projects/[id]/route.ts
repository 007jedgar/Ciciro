import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

// GET /api/projects/:id — full project with chapters, characters, plot points.
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      chapters: { orderBy: { order: "asc" } },
      characters: { orderBy: { name: "asc" } },
      plotPoints: { orderBy: { order: "asc" } },
    },
  });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(project);
}

const EDITABLE = [
  "title",
  "author",
  "genre",
  "logline",
  "synopsis",
  "theme",
  "pov",
  "notes",
] as const;

// PATCH /api/projects/:id — update story-bible fields.
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const data: Record<string, string> = {};
  for (const key of EDITABLE) {
    if (typeof body[key] === "string") data[key] = body[key];
  }
  const project = await prisma.project.update({ where: { id }, data });
  return NextResponse.json(project);
}

// DELETE /api/projects/:id — remove a project and all its content.
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  await prisma.project.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
