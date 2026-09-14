import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError } from "@/lib/auth/http";
import { getReadingPosition, putReadingPosition } from "@/lib/reading-position";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

// GET /api/projects/:id/position — this user's durable reading cursor.
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser(req);
  try {
    const position = await getReadingPosition(id, user);
    return NextResponse.json({ position });
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
}

// PUT /api/projects/:id/position — last-write-wins upsert of the reading cursor.
export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser(req);
  const body = await req.json().catch(() => ({}));
  try {
    const position = await putReadingPosition(id, user, body);
    return NextResponse.json({ position });
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
}
