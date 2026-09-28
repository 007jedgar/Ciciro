import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getModelSummary } from "@/lib/models";

export const runtime = "nodejs";

// GET /api/models — the models actually in effect (resolved env value or
// default), for the Settings "running on" line. No keys or secrets.
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  return NextResponse.json(getModelSummary());
}
