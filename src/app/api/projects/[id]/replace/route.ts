import { NextRequest, NextResponse, after } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError } from "@/lib/auth/http";
import { replaceInProject, type ReplaceRequest } from "@/lib/project-search";
import { summarizeChapter } from "@/lib/summarize";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

function parseTarget(value: unknown): ReplaceRequest["target"] | null | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object") return null;
  const t = value as Record<string, unknown>;
  if (typeof t.chapterId !== "string" || typeof t.blockId !== "string") return null;
  if (!Number.isInteger(t.occurrence) || (t.occurrence as number) < 0) return null;
  if (!Number.isInteger(t.offset) || (t.offset as number) < 0) return null;
  return {
    chapterId: t.chapterId,
    blockId: t.blockId,
    occurrence: t.occurrence as number,
    offset: t.offset as number,
  };
}

// POST /api/projects/:id/replace — replace one match (`target`) or every match
// in the manuscript. Goes through the chapter op log, so every device syncs it.
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser(req);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const target = parseTarget(body.target);
  if (
    typeof body.query !== "string" ||
    typeof body.replacement !== "string" ||
    target === null
  ) {
    return NextResponse.json({ error: "Invalid replace request." }, { status: 400 });
  }
  try {
    const result = await replaceInProject(id, user, {
      query: body.query,
      replacement: body.replacement,
      matchCase: body.matchCase === true,
      wholeWord: body.wholeWord === true,
      target,
    });
    for (const chapter of result.chapters) {
      after(() => summarizeChapter(chapter.id).catch(() => {}));
    }
    return NextResponse.json(result);
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
}
