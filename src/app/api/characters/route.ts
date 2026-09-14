import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError } from "@/lib/auth/http";
import { createCharacter, listCharacters } from "@/lib/story";

export const runtime = "nodejs";

// GET /api/characters?projectId=... — list characters for a manuscript.
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }
  const user = await getSessionUser(req);
  try {
    const characters = await listCharacters(projectId, user);
    return NextResponse.json(characters);
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
}

// POST /api/characters — add a character to the story bible.
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req);
  const body = await req.json().catch(() => ({}));
  try {
    const character = await createCharacter(user, body);
    return NextResponse.json(character, { status: 201 });
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
}
