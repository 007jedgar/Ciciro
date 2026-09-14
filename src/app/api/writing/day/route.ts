import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError, responseFromDbError } from "@/lib/auth/http";
import { getWritingDay, putWritingDay } from "@/lib/writing-day-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonDay(day: Awaited<ReturnType<typeof getWritingDay>>) {
  return NextResponse.json({
    day: {
      date: day.date,
      words: day.words,
      activeMs: day.activeMs,
      updatedAt: day.updatedAt.toISOString(),
    },
  });
}

// GET /api/writing/day?date=YYYY-MM-DD — today's merged words + active time.
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  const date = req.nextUrl.searchParams.get("date");
  try {
    const day = await getWritingDay(user, date);
    return jsonDay(day);
  } catch (error) {
    const failure = responseFromAuthError(error) ?? responseFromDbError(error);
    if (failure) return failure;
    throw error;
  }
}

// PUT /api/writing/day — add a heartbeat; same date merges.
export async function PUT(req: NextRequest) {
  const user = await getSessionUser(req);
  const body = await req.json().catch(() => ({}));
  try {
    const day = await putWritingDay(user, body);
    return jsonDay(day);
  } catch (error) {
    const failure = responseFromAuthError(error) ?? responseFromDbError(error);
    if (failure) return failure;
    throw error;
  }
}
