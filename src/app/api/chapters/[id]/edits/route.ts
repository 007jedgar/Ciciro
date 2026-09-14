import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError } from "@/lib/auth/http";
import { listChapterEdits } from "@/lib/chapters";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

// GET /api/chapters/:id/edits — the chapter's most recent editor-applied
// corrections (find/replace pairs), newest first, for the diff view.
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser(req);
  try {
    const edits = await listChapterEdits(id, user);
    return NextResponse.json(edits);
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
}
