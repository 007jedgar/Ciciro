import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

// GET /api/chapters/:id/edits — the chapter's most recent editor-applied
// corrections (find/replace pairs), newest first, for the diff view.
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const edits = await prisma.manuscriptEdit.findMany({
    where: { chapterId: id },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  return NextResponse.json(edits);
}
