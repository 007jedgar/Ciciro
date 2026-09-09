import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError } from "@/lib/auth/http";
import { createChapter, listChapters } from "@/lib/chapters";

export const runtime = "nodejs";

// GET /api/chapters?projectId=... — list chapters in order.
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }
  const user = await getSessionUser();
  try {
    const chapters = await listChapters(projectId, user);
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
