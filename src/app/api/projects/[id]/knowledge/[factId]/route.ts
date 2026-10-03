import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError, responseFromDbError } from "@/lib/auth/http";
import { retireKnowledgeFact } from "@/lib/knowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; factId: string }> };

// DELETE /api/projects/:id/knowledge/:factId — supersede a fact and refresh the mirror.
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id, factId } = await ctx.params;
  const user = await getSessionUser(req);
  try {
    await retireKnowledgeFact(id, user, factId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const failure = responseFromAuthError(error) ?? responseFromDbError(error);
    if (failure) return failure;
    throw error;
  }
}
