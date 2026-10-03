import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError, responseFromDbError } from "@/lib/auth/http";
import { deleteCanvasEdge } from "@/lib/canvas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; edgeId: string }> };

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id, edgeId } = await ctx.params;
  const user = await getSessionUser(req);
  try {
    await deleteCanvasEdge(id, user, edgeId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const failure = responseFromAuthError(error) ?? responseFromDbError(error);
    if (failure) return failure;
    throw error;
  }
}
