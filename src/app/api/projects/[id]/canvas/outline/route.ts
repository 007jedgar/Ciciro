import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError, responseFromDbError } from "@/lib/auth/http";
import { createOutlineFromReply } from "@/lib/canvas";
import { AuthError } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/projects/:id/canvas/outline — accept a generated outline onto the board.
// Body: { cardId, raw }. A reply that does not parse creates no cards.
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getSessionUser(req);
  const body = await req.json().catch(() => ({}));
  const src = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const cardId = typeof src.cardId === "string" ? src.cardId : "";
  const raw = typeof src.raw === "string" ? src.raw : "";
  try {
    if (!cardId) throw new AuthError("Choose the premise card.", 400);
    const result = await createOutlineFromReply(id, user, cardId, raw);
    if (result.created === 0) {
      throw new AuthError("That outline couldn't be read. No cards were added.", 422);
    }
    return NextResponse.json(result);
  } catch (error) {
    const failure = responseFromAuthError(error) ?? responseFromDbError(error);
    if (failure) return failure;
    throw error;
  }
}
