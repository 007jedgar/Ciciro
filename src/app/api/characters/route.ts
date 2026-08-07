import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// POST /api/characters — add a character to the story bible.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!body.projectId || !body.name?.trim()) {
    return NextResponse.json({ error: "projectId and name required" }, { status: 400 });
  }
  const character = await prisma.character.create({
    data: {
      projectId: body.projectId,
      name: body.name.trim(),
      role: body.role?.trim() || "",
      description: body.description?.trim() || "",
      arc: body.arc?.trim() || "",
      notes: body.notes?.trim() || "",
    },
  });
  return NextResponse.json(character, { status: 201 });
}
