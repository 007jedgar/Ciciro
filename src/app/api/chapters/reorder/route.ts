import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError } from "@/lib/auth/http";
import { reorderChapters } from "@/lib/chapters";

export const runtime = "nodejs";

// POST /api/chapters/reorder — { projectId, chapterIds } puts the live
// chapters in that order and returns them renumbered.
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req);
  const body = await req.json().catch(() => ({}));
  try {
    const chapters = await reorderChapters(user, body);
    return NextResponse.json(chapters);
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
}
