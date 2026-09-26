import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError, responseFromDbError } from "@/lib/auth/http";
import { deleteWeeklyReview, getWeeklyReview } from "@/lib/weekly-review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; reviewId: string }> };

// GET /api/projects/:id/weekly-reviews/:reviewId — one stored review.
export async function GET(req: NextRequest, ctx: Ctx) {
  const { id, reviewId } = await ctx.params;
  const user = await getSessionUser(req);
  try {
    return NextResponse.json(await getWeeklyReview(id, reviewId, user));
  } catch (error) {
    const failure = responseFromAuthError(error) ?? responseFromDbError(error);
    if (failure) return failure;
    throw error;
  }
}

// DELETE /api/projects/:id/weekly-reviews/:reviewId
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id, reviewId } = await ctx.params;
  const user = await getSessionUser(req);
  try {
    await deleteWeeklyReview(id, reviewId, user);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const failure = responseFromAuthError(error) ?? responseFromDbError(error);
    if (failure) return failure;
    throw error;
  }
}
