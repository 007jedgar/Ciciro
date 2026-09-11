import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError } from "@/lib/auth/http";
import { archiveChapter, unarchiveChapter } from "@/lib/chapters";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

// POST /api/chapters/:id/archive — hide a chapter. Any chapter may be archived.
export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser();
  try {
    const chapter = await archiveChapter(id, user);
    return NextResponse.json(chapter);
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
}

// DELETE /api/chapters/:id/archive — restore a hidden chapter to the live list.
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser();
  try {
    const chapter = await unarchiveChapter(id, user);
    return NextResponse.json(chapter);
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
}
