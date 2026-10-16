import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError, responseFromDbError } from "@/lib/auth/http";
import { readScannedNotes } from "@/lib/scan-notes";
import { SCAN_PAGE_BYTES_MAX, SCAN_PAGES_MAX } from "@/lib/scan-notes-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const TOO_LARGE = "Those photos are too large to read at once.";

// POST /api/projects/:id/scan-notes, multipart: one or more `page` image
// files, in reading order. Replies with the transcription ({ text, pages,
// kind, title, status, uncertain }); nothing is stored and nothing is added
// to the manuscript. Costs one AI run, refunded when nothing could be read.
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getSessionUser(req);
  if (Number(req.headers.get("content-length") ?? 0) > SCAN_PAGE_BYTES_MAX * SCAN_PAGES_MAX + 64 * 1024) {
    return NextResponse.json({ error: TOO_LARGE }, { status: 413 });
  }
  const form = await req.formData().catch(() => null);
  const files = form?.getAll("page").filter((value): value is File => value instanceof File) ?? [];
  try {
    const photos = await Promise.all(files.map(async (file) => ({ data: new Uint8Array(await file.arrayBuffer()) })));
    return NextResponse.json(await readScannedNotes(id, user, photos));
  } catch (error) {
    const failure = responseFromAuthError(error) ?? responseFromDbError(error);
    if (failure) return failure;
    throw error;
  }
}
