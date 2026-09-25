import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError, responseFromDbError } from "@/lib/auth/http";
import { getWritingDays } from "@/lib/writing-day-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/writing/days?from=YYYY-MM-DD&to=YYYY-MM-DD — range of merged daily totals.
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  try {
    const days = await getWritingDays(user, from, to);
    return NextResponse.json({
      from,
      to,
      days: days.map((day) => ({
        date: day.date,
        words: day.words,
        activeMs: day.activeMs,
        updatedAt: day.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    const failure = responseFromAuthError(error) ?? responseFromDbError(error);
    if (failure) return failure;
    throw error;
  }
}
