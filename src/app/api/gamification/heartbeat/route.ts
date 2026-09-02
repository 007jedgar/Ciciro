import { NextRequest, NextResponse } from "next/server";
import { requireGamificationUser } from "@/lib/gamification/http";
import { recordHeartbeat } from "@/lib/gamification/store";

export const runtime = "nodejs";

// POST /api/gamification/heartbeat — chair time and/or a writing action.
export async function POST(req: NextRequest) {
  const auth = await requireGamificationUser();
  if ("response" in auth) return auth.response;
  const body = await req.json().catch(() => ({}));

  let chairSeconds: number | undefined;
  if (body.chairSeconds !== undefined) {
    if (typeof body.chairSeconds !== "number" || !Number.isFinite(body.chairSeconds)) {
      return NextResponse.json(
        { error: "Chair seconds must be a number." },
        { status: 400 }
      );
    }
    chairSeconds = body.chairSeconds;
  }

  const wrote = body.wrote === true;
  const timezone = typeof body.timezone === "string" ? body.timezone : undefined;

  const today = await recordHeartbeat({
    userId: auth.user.id,
    chairSeconds,
    wrote,
    timezone,
  });
  return NextResponse.json(today);
}
