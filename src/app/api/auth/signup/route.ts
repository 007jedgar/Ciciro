import { NextRequest, NextResponse } from "next/server";
import { AuthError, createSession, registerUser } from "@/lib/auth/session";

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
    await createSession(user.id, req.headers.get("user-agent") || "");
    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not create account." }, { status: 500 });
  }
}
