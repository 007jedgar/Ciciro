import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/constants";
import { destroySession } from "@/lib/auth/session";

export const runtime = "nodejs";

// POST /api/auth/logout — end the current session.
export async function POST(req: NextRequest) {
  await destroySession(req);
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
