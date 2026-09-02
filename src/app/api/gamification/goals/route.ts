import { NextRequest, NextResponse } from "next/server";
import { parseGoalsPatch } from "@/lib/gamification/goals";
import { requireGamificationUser } from "@/lib/gamification/http";
import { getGoals, patchGoals } from "@/lib/gamification/store";

export const runtime = "nodejs";

// GET /api/gamification/goals — targets, reminder cadence, quiet hours, timezone.
export async function GET() {
  const auth = await requireGamificationUser();
  if ("response" in auth) return auth.response;
  const goals = await getGoals(auth.user.id);
  return NextResponse.json(goals);
}

// PATCH /api/gamification/goals — partial update of the same fields.
export async function PATCH(req: NextRequest) {
  const auth = await requireGamificationUser();
  if ("response" in auth) return auth.response;
  const body = await req.json().catch(() => null);
  const parsed = parseGoalsPatch(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const result = await patchGoals(auth.user.id, parsed);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result);
}
