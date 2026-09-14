import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError } from "@/lib/auth/http";
import { correctBlock } from "@/lib/correct";

export const runtime = "nodejs";

// POST /api/correct — Haiku spelling/grammar spans for one block. Fail-soft.
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  try {
    const result = await correctBlock(user, body);
    return NextResponse.json(result);
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
}
