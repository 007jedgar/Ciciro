import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError, responseFromDbError } from "@/lib/auth/http";
import { generateWeeklyReview, listWeeklyReviews } from "@/lib/weekly-review";
import { reviewDue } from "@/lib/weekly-review-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

// GET /api/projects/:id/weekly-reviews — past reviews, newest first, and
// whether a new one is due (none yet, or the newest is a week old).
export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getSessionUser(req);
  try {
    const reviews = await listWeeklyReviews(id, user);
    return NextResponse.json({ reviews, due: reviewDue(reviews) });
  } catch (error) {
    const failure = responseFromAuthError(error) ?? responseFromDbError(error);
    if (failure) return failure;
    throw error;
  }
}

// POST /api/projects/:id/weekly-reviews — write a review of the seven days
// ending `to` (a YYYY-MM-DD local day, default today). Body: { to?, tzOffset? },
// where tzOffset is the author's `Date#getTimezoneOffset()` in minutes.
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getSessionUser(req);
  const body = await req.json().catch(() => ({}));
  try {
    return NextResponse.json(await generateWeeklyReview(id, user, body), { status: 201 });
  } catch (error) {
    const failure = responseFromAuthError(error) ?? responseFromDbError(error);
    if (failure) return failure;
    throw error;
  }
}
