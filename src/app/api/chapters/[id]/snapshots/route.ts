import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError } from "@/lib/auth/http";
import { listSnapshots, saveManualSnapshot } from "@/lib/snapshots";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

// GET /api/chapters/:id/snapshots — the chapter's version history, newest
// first, without the prose.
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser(req);
  try {
    const snapshots = await listSnapshots(id, user);
    return NextResponse.json({ snapshots });
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
}

// POST /api/chapters/:id/snapshots — save the chapter's current text as a
// manual snapshot. Body: { label?: string }.
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser(req);
  const body = await req.json().catch(() => ({}));
  try {
    const snapshot = await saveManualSnapshot(id, user, body ?? {});
    return NextResponse.json(snapshot, { status: 201 });
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
}
