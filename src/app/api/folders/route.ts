import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError } from "@/lib/auth/http";
import { createFolder, listFolders } from "@/lib/folders";

export const runtime = "nodejs";

// GET /api/folders — list folders with their manuscripts. When a user is
// signed in, only their folders are returned; local-first lists all.
export async function GET() {
  const user = await getSessionUser();
  const folders = await listFolders(user);
  return NextResponse.json(folders);
}

// POST /api/folders — create a folder, optionally filing manuscripts into it.
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  const body = await req.json().catch(() => ({}));
  try {
    const folder = await createFolder(user, body);
    return NextResponse.json(folder, { status: 201 });
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
}
