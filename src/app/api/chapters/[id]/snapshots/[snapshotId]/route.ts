import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError } from "@/lib/auth/http";
import { deleteSnapshot, getSnapshot } from "@/lib/snapshots";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string; snapshotId: string }> };

// GET /api/chapters/:id/snapshots/:snapshotId — one snapshot, with its prose.
export async function GET(req: NextRequest, { params }: Params) {
  const { id, snapshotId } = await params;
  const user = await getSessionUser(req);
  try {
    const snapshot = await getSnapshot(id, snapshotId, user);
    return NextResponse.json(snapshot);
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
}

// DELETE /api/chapters/:id/snapshots/:snapshotId — forget one snapshot.
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id, snapshotId } = await params;
  const user = await getSessionUser(req);
  try {
    const result = await deleteSnapshot(id, snapshotId, user);
    return NextResponse.json(result);
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
}
