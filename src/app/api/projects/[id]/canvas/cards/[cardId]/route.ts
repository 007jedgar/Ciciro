import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError, responseFromDbError } from "@/lib/auth/http";
import { deleteCanvasCard, updateCanvasCard } from "@/lib/canvas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; cardId: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id, cardId } = await ctx.params;
  const user = await getSessionUser(req);
  const body = await req.json().catch(() => ({}));
  try {
    return NextResponse.json(await updateCanvasCard(id, user, cardId, body));
  } catch (error) {
    const failure = responseFromAuthError(error) ?? responseFromDbError(error);
    if (failure) return failure;
    throw error;
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id, cardId } = await ctx.params;
  const user = await getSessionUser(req);
  try {
    await deleteCanvasCard(id, user, cardId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const failure = responseFromAuthError(error) ?? responseFromDbError(error);
    if (failure) return failure;
    throw error;
  }
}
