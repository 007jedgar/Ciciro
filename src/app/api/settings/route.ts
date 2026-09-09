import { NextRequest, NextResponse } from "next/server";
import { AuthError, getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError } from "@/lib/auth/http";
import { getUserSettings, replaceUserSettings, updateUserSettings } from "@/lib/user-settings";

export const runtime = "nodejs";

// GET /api/settings — the signed-in user's synced chrome prefs.
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  try {
    const settings = await getUserSettings(user.id);
    return NextResponse.json({ settings });
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
}

// PATCH /api/settings — merge fields into the stored prefs.
export async function PATCH(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  try {
    const settings = await updateUserSettings(user.id, body);
    return NextResponse.json({ settings });
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
}

// PUT /api/settings — replace prefs (used when a device's local copy is newer).
export async function PUT(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  try {
    const settings = await replaceUserSettings(user.id, body);
    return NextResponse.json({ settings });
  } catch (error) {
    if (error instanceof AuthError) {
      const failure = responseFromAuthError(error);
      if (failure) return failure;
    }
    throw error;
  }
}
