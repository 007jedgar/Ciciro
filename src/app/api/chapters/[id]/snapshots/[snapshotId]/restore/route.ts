import { NextRequest, NextResponse, after } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError } from "@/lib/auth/http";
import { restoreSnapshot } from "@/lib/snapshot-restore";
import { summarizeChapter } from "@/lib/summarize";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string; snapshotId: string }> };

// POST /api/chapters/:id/snapshots/:snapshotId/restore — put the snapshot's
// text back on the chapter, through the op log. The replaced text is kept as
// a "before_restore" snapshot. Returns { chapter, restored, backup }.
export async function POST(req: NextRequest, { params }: Params) {
  const { id, snapshotId } = await params;
  const user = await getSessionUser(req);
  try {
    const result = await restoreSnapshot(id, snapshotId, user);
    after(() => summarizeChapter(id).catch(() => {}));
    return NextResponse.json(result);
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
}
