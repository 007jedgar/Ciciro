import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError } from "@/lib/auth/http";
import { createChapter, listChapters } from "@/lib/chapters";

export const runtime = "nodejs";

function readArchivedFlag(value: string | null): boolean {
  return value === "1" || value === "true";
}

// GET /api/chapters?projectId=... — list live chapters in order.
// Pass archived=true to list hidden (archived) chapters instead.
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }
  const archived = readArchivedFlag(req.nextUrl.searchParams.get("archived"));
  const user = await getSessionUser();
  try {
    const chapters = await listChapters(projectId, user, { archived });
    return NextResponse.json(chapters);
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
}

// POST /api/chapters — add a chapter to a project (appended to the end).
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  const body = await req.json().catch(() => ({}));
  try {
    const chapter = await createChapter(user, body);
    return NextResponse.json(chapter, { status: 201 });
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
}
