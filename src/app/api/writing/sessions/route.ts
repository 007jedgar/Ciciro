import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError, responseFromDbError } from "@/lib/auth/http";
import { listWritingSessions, putWritingSession } from "@/lib/writing-session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonSession(session: Awaited<ReturnType<typeof putWritingSession>>) {
  return {
    id: session.id,
    projectId: session.projectId,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    words: session.words,
    activeMs: session.activeMs,
  };
}

// GET /api/writing/sessions?limit=50 — recent closed sittings.
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  const limitRaw = req.nextUrl.searchParams.get("limit");
  const limit = limitRaw ? Number(limitRaw) : 50;
  try {
    const sessions = await listWritingSessions(user, Number.isFinite(limit) ? limit : 50);
    return NextResponse.json({ sessions: sessions.map(jsonSession) });
  } catch (error) {
    const failure = responseFromAuthError(error) ?? responseFromDbError(error);
    if (failure) return failure;
    throw error;
  }
}

// POST /api/writing/sessions — record a closed sitting.
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req);
  const body = await req.json().catch(() => ({}));
  try {
    const session = await putWritingSession(user, body);
    return NextResponse.json({ session: jsonSession(session) });
  } catch (error) {
    const failure = responseFromAuthError(error) ?? responseFromDbError(error);
    if (failure) return failure;
    throw error;
  }
}
