import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";

export const runtime = "nodejs";

// GET /api/auth/me — the current user, or null when not signed in.
export async function GET() {
  const user = await getSessionUser();
  return NextResponse.json({ user });
}
