import { NextRequest, NextResponse } from "next/server";
import { isNativeClient } from "@/lib/auth/constants";
import { jsonWithSession, responseFromDbError } from "@/lib/auth/http";
import { AuthError, createSession, registerUser } from "@/lib/auth/session";
import { getUserSettings } from "@/lib/user-settings";

export const runtime = "nodejs";

// POST /api/auth/signup — create an account and start a session.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  try {
    const user = await registerUser({
      email: body.email,
      password: body.password,
      name: body.name,
    });
    const token = await createSession(user.id, req.headers.get("user-agent") || "");
    const settings = await getUserSettings(user.id);
    return jsonWithSession({ user, settings }, token, isNativeClient(req), { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const mapped = responseFromDbError(error);
    if (mapped) return mapped;
    console.error("signup failed", error);
    return NextResponse.json({ error: "Could not create account." }, { status: 500 });
  }
}
