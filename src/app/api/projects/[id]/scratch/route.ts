import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError, responseFromDbError } from "@/lib/auth/http";
import { createScratchNote, listScratchNotes } from "@/lib/scratch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/projects/:id/scratch — the scratchpad's notes, newest edit first.
export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getSessionUser(req);
  try {
    return NextResponse.json({ notes: await listScratchNotes(id, user) });
  } catch (error) {
    const failure = responseFromAuthError(error) ?? responseFromDbError(error);
    if (failure) return failure;
    throw error;
  }
}

// POST /api/projects/:id/scratch — add a note. Body: { title?, content? }.
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getSessionUser(req);
  const body = await req.json().catch(() => ({}));
  try {
    return NextResponse.json(await createScratchNote(id, user, body), { status: 201 });
  } catch (error) {
    const failure = responseFromAuthError(error) ?? responseFromDbError(error);
    if (failure) return failure;
    throw error;
  }
}
