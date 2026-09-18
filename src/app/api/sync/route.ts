import { NextRequest, NextResponse } from "next/server";
import { AuthError, getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError, responseFromDbError } from "@/lib/auth/http";
import { unsupportedOpVersion } from "@/lib/chapter-ops";
import { OP_VERSION } from "@/lib/manuscript";
import {
  parseSyncAfter,
  parseSyncOp,
  pullSync,
  pushSync,
  type SyncBibleWrite,
} from "@/lib/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function afterFromRequest(req: NextRequest, bodyAfter?: unknown) {
  if (bodyAfter !== undefined) return parseSyncAfter(bodyAfter);
  const after = req.nextUrl.searchParams.get("after");
  if (after) return parseSyncAfter(after);
  const chapters = req.nextUrl.searchParams.get("afterChapters");
  const bible = req.nextUrl.searchParams.get("afterBible");
  if (!chapters && !bible) return {};
  return parseSyncAfter({
    chapters: chapters ? JSON.parse(chapters) : undefined,
    bible: bible ? JSON.parse(bible) : undefined,
  });
}

// GET /api/sync?projectId=&after= — pull ops, bible, and position.
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId") ?? "";
  const user = await getSessionUser(req);
  try {
    const after = afterFromRequest(req);
    const result = await pullSync(projectId, user, after);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "after must be JSON" }, { status: 400 });
    }
    const failure = responseFromAuthError(error) ?? responseFromDbError(error);
    if (failure) return failure;
    throw error;
  }
}

// POST /api/sync — push ops / bible / position, then pull heads and leftovers.
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req);
  const body = await req.json().catch(() => ({}));
  const projectId = typeof body.projectId === "string" ? body.projectId : "";
  const rawOps = body.ops === undefined ? [] : body.ops;
  if (!Array.isArray(rawOps)) {
    return NextResponse.json({ error: "ops must be an array" }, { status: 400 });
  }
  const unsupported = unsupportedOpVersion(rawOps);
  if (unsupported !== null) {
    // Told to upgrade, not quietly half-applied. See OP_VERSION.
    return NextResponse.json(
      {
        error: "Unsupported manuscript op version",
        sentVersion: unsupported,
        supportedVersion: OP_VERSION,
      },
      { status: 426 }
    );
  }
  const ops = [];
  for (const item of rawOps) {
    const parsed = parseSyncOp(item);
    if (!parsed) {
      return NextResponse.json({ error: "Invalid manuscript op" }, { status: 400 });
    }
    ops.push(parsed);
  }
  const bible = Array.isArray(body.bible)
    ? body.bible.filter(
        (file: unknown): file is SyncBibleWrite =>
          !!file &&
          typeof file === "object" &&
          typeof (file as SyncBibleWrite).path === "string" &&
          typeof (file as SyncBibleWrite).content === "string" &&
          Number.isInteger((file as SyncBibleWrite).revision)
      )
    : [];
  const position =
    body.position && typeof body.position === "object"
      ? {
          chapterId: body.position.chapterId,
          blockId: body.position.blockId,
          offset: body.position.offset,
        }
      : undefined;
  try {
    const after = afterFromRequest(req, body.after);
    const result = await pushSync(projectId, user, { after, ops, bible, position });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AuthError) {
      const failure = responseFromAuthError(error);
      if (failure) return failure;
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "after must be JSON" }, { status: 400 });
    }
    const missing = responseFromDbError(error);
    if (missing) return missing;
    throw error;
  }
}
