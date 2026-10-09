import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError } from "@/lib/auth/http";
import { synonymsFor } from "@/lib/synonyms";

export const runtime = "nodejs";

// POST /api/synonyms - Haiku replacements for one highlighted word. Fail-soft.
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  try {
    return NextResponse.json(await synonymsFor(user, body));
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
}
