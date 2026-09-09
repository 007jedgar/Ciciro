import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getUserSettings } from "@/lib/user-settings";

export const runtime = "nodejs";

// GET /api/auth/me — the current user, or null when not signed in.
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ user: null, settings: null });
  const settings = await getUserSettings(user.id);
  return NextResponse.json({ user, settings });
}
