import { NextRequest, NextResponse, after } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError } from "@/lib/auth/http";
import { deleteChapter, updateChapter } from "@/lib/chapters";
import { summarizeChapter } from "@/lib/summarize";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/chapters/:id — save content, title, order, status, or summary.
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser();
  const body = await req.json().catch(() => ({}));
  try {
    const result = await updateChapter(id, user, body);
    if (result.contentChanged) {
      after(() => summarizeChapter(id).catch(() => {}));
    }
    return NextResponse.json(result.chapter);
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
}

// DELETE /api/chapters/:id — remove a chapter and re-number the rest.
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser();
  try {
    const result = await deleteChapter(id, user);
    return NextResponse.json(result);
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
}
