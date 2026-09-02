import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth/session";

export const runtime = "nodejs";

// POST /api/auth/logout — end the current session.
export async function POST() {
  await destroySession();
  return NextResponse.json({ ok: true });
}
