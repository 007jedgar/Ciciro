import { NextRequest, NextResponse } from "next/server";
import { AuthError, authenticate, createSession } from "@/lib/auth/session";
import { getUserSettings } from "@/lib/user-settings";

export const runtime = "nodejs";

// POST /api/auth/login — verify credentials and start a session.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  try {
    const user = await authenticate({ email: body.email, password: body.password });
    await createSession(user.id, req.headers.get("user-agent") || "");
    const settings = await getUserSettings(user.id);
    return NextResponse.json({ user, settings });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not sign in." }, { status: 500 });
  }
}
