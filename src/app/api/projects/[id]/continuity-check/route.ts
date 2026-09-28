import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError, responseFromDbError } from "@/lib/auth/http";
import { runContinuityCheck } from "@/lib/continuity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

// POST /api/projects/:id/continuity-check — extract factual claims from a
// chapter (or, with scope "book", every chapter) and flag what contradicts
// canon.md, world.md, timeline.md, or a named character's file.
// Body: { scope?: "chapter" | "book", chapterId?: string }. chapterId is
// required when scope is "chapter" (the default).
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getSessionUser(req);
  const body = await req.json().catch(() => ({}));
  try {
    return NextResponse.json(await runContinuityCheck(id, user, body));
  } catch (error) {
    const failure = responseFromAuthError(error) ?? responseFromDbError(error);
    if (failure) return failure;
    throw error;
  }
}
