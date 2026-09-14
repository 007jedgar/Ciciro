import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError } from "@/lib/auth/http";
import { createQuestion, listQuestions } from "@/lib/story";

export const runtime = "nodejs";

// GET /api/questions?projectId=...[&status=open] — list open questions.
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  const status = req.nextUrl.searchParams.get("status");
  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }
  const user = await getSessionUser(req);
  try {
    const questions = await listQuestions(projectId, user, status);
    return NextResponse.json(questions);
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
}

// POST /api/questions — create one manually.
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req);
  const body = await req.json().catch(() => ({}));
  try {
    const q = await createQuestion(user, body);
    return NextResponse.json(q, { status: 201 });
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
}
