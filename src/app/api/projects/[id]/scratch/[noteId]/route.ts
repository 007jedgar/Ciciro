import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError, responseFromDbError } from "@/lib/auth/http";
import { deleteScratchNote, getScratchNote, updateScratchNote } from "@/lib/scratch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; noteId: string }> };

async function handle(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    const failure = responseFromAuthError(error) ?? responseFromDbError(error);
    if (failure) return failure;
    throw error;
  }
}

// GET /api/projects/:id/scratch/:noteId
export async function GET(req: NextRequest, ctx: Ctx) {
  const { id, noteId } = await ctx.params;
  const user = await getSessionUser(req);
  return handle(async () => NextResponse.json(await getScratchNote(id, noteId, user)));
}

// PATCH /api/projects/:id/scratch/:noteId — Body: { title?, content?, expectedRevision? }.
// A stale expectedRevision answers 409 with { currentRevision, note }.
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id, noteId } = await ctx.params;
  const user = await getSessionUser(req);
  const body = await req.json().catch(() => ({}));
  return handle(async () => NextResponse.json(await updateScratchNote(id, noteId, user, body)));
}

// DELETE /api/projects/:id/scratch/:noteId
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id, noteId } = await ctx.params;
  const user = await getSessionUser(req);
  return handle(async () => {
    await deleteScratchNote(id, noteId, user);
    return NextResponse.json({ ok: true });
  });
}
