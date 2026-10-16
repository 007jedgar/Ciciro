import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError, responseFromDbError } from "@/lib/auth/http";
import { applyScannedNotes } from "@/lib/scan-notes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/projects/:id/scan-notes/apply: add the reviewed text where the
// writer chose. Body: { text, destination } with destination one of
//   { type: "bible", mode: "append", path }            (a dated section at the end of a file)
//   { type: "bible", mode: "new", kind, name }         (a new character / plot-line file)
//   { type: "canvas" }                                 (new cards below the board)
// Adds only; free of charge. Never touches a chapter.
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getSessionUser(req);
  const body = await req.json().catch(() => ({}));
  try {
    return NextResponse.json(await applyScannedNotes(id, user, body), { status: 201 });
  } catch (error) {
    const failure = responseFromAuthError(error) ?? responseFromDbError(error);
    if (failure) return failure;
    throw error;
  }
}
