import { NextResponse } from "next/server";
import { requireGamificationUser } from "@/lib/gamification/http";
import { settleDay } from "@/lib/gamification/store";

export const runtime = "nodejs";

// GET /api/gamification/today — rings, streak, credit balance for the local day.
export async function GET() {
  const auth = await requireGamificationUser();
  if ("response" in auth) return auth.response;
  const today = await settleDay(auth.user.id);
  return NextResponse.json(today);
}
