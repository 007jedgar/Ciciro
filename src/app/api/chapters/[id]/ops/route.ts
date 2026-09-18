import { NextRequest, NextResponse } from "next/server";
import { AuthError, getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError } from "@/lib/auth/http";
import { OP_VERSION } from "@/lib/manuscript";
import {
  appendOps,
  listChapterOps,
  parseManuscriptOp,
  unsupportedOpVersion,
} from "@/lib/chapter-ops";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/**
 * A build newer than this server is talking to us. Say so plainly instead of
 * parsing the fields we recognize and dropping the rest — a silent partial
 * apply is how prose goes missing.
 */
function upgradeRequired(sent: number) {
  return {
    error: "Unsupported manuscript op version",
    sentVersion: sent,
    supportedVersion: OP_VERSION,
  };
}

// GET /api/chapters/:id/ops?after=seq — ops after seq (default 0).
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser(req);
  const afterRaw = req.nextUrl.searchParams.get("after");
  const after = afterRaw == null || afterRaw === "" ? 0 : Number(afterRaw);
  if (!Number.isInteger(after) || after < 0) {
    return NextResponse.json({ error: "after must be a non-negative integer" }, { status: 400 });
  }
  try {
    const result = await listChapterOps(id, user, after);
    return NextResponse.json(result);
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
}

// POST /api/chapters/:id/ops — append author block ops.
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser(req);
  const body = await req.json().catch(() => ({}));
  const rawOps = Array.isArray(body.ops) ? body.ops : null;
  if (!rawOps) {
    return NextResponse.json({ error: "ops array required" }, { status: 400 });
  }
  const unsupported = unsupportedOpVersion(rawOps);
  if (unsupported !== null) {
    return NextResponse.json(upgradeRequired(unsupported), { status: 426 });
  }
  const ops = [];
  for (const item of rawOps) {
    const parsed = parseManuscriptOp(item);
    if (!parsed) {
      return NextResponse.json({ error: "Invalid manuscript op" }, { status: 400 });
    }
    ops.push(parsed);
  }
  try {
    const result = await appendOps(id, user, ops, { actor: "user" });
    if (result.rejected.length > 0 && result.ops.length === 0) {
      throw new AuthError("Chapter revision conflict", 409, {
        error: "Chapter revision conflict",
        accepted: result.accepted,
        rejected: result.rejected,
        chapter: result.chapter,
        currentRevision: result.chapter.revision,
      });
    }
    return NextResponse.json(result);
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
}
