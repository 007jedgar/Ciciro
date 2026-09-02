import { NextRequest, NextResponse, after } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { countWords, htmlToText } from "@/lib/text";
import { summarizeChapter } from "@/lib/summarize";
import type { InputMeta } from "@/lib/gamification/attribution";
import type { SaveSource } from "@/lib/gamification/constants";
import { recordChapterSave } from "@/lib/gamification/store";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

function parseInputMeta(raw: unknown): InputMeta | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  const meta: InputMeta = {};
  for (const key of ["typedChars", "pastedChars", "compositionMs"] as const) {
    const value = obj[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      meta[key] = value;
    }
  }
  return Object.keys(meta).length ? meta : undefined;
}

function parseSourceHint(raw: unknown): SaveSource | undefined {
  if (raw === "autowrite" || raw === "draft_insert" || raw === "editor_mutate") {
    return raw;
  }
  return undefined;
}

// PATCH /api/chapters/:id — save content, title, order, status, or summary.
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const data: Prisma.ChapterUpdateManyMutationInput = {};

  if (typeof body.content === "string") {
    data.content = body.content;
    data.wordCount = countWords(htmlToText(body.content));
  }
  if (typeof body.title === "string") data.title = body.title;
  if (typeof body.summary === "string") data.summary = body.summary;
  if (typeof body.status === "string") data.status = body.status;
  if (typeof body.order === "number") data.order = body.order;

  if (!Number.isInteger(body.expectedRevision) || body.expectedRevision < 0) {
    return NextResponse.json(
      { error: "expectedRevision is required for chapter updates" },
      { status: 428 }
    );
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No chapter fields to update" }, { status: 400 });
  }

  const result = await prisma.$transaction(async (tx) => {
    const previous =
      typeof body.content === "string"
        ? await tx.chapter.findUnique({
            where: { id },
            select: {
              content: true,
              project: { select: { userId: true } },
            },
          })
        : null;
    const updated = await tx.chapter.updateMany({
      where: { id, revision: body.expectedRevision },
      data: { ...data, revision: { increment: 1 } },
    });
    const chapter = await tx.chapter.findUnique({ where: { id } });
    return { updated: updated.count === 1, chapter, previous };
  });

  if (!result.chapter) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!result.updated) {
    return NextResponse.json(
      {
        error: "Chapter revision conflict",
        expectedRevision: body.expectedRevision,
        currentRevision: result.chapter.revision,
        chapter: result.chapter,
      },
      { status: 409 }
    );
  }

  // Refresh the beat summary in the background - don't hold up the autosave.
  if (typeof body.content === "string") {
    after(() => summarizeChapter(id).catch(() => {}));
    const ownerId = result.previous?.project.userId;
    if (ownerId && result.previous) {
      const prevContent = result.previous.content;
      const nextContent = body.content;
      const inputMeta = parseInputMeta(body.inputMeta);
      const sourceHint = parseSourceHint(body.source);
      after(() =>
        recordChapterSave({
          userId: ownerId,
          chapterId: id,
          prevContent,
          nextContent,
          inputMeta,
          sourceHint,
        }).catch(() => {})
      );
    }
  }

  return NextResponse.json(result.chapter);
}

// DELETE /api/chapters/:id — remove a chapter and re-number the rest.
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const chapter = await prisma.chapter.findUnique({ where: { id } });
  if (!chapter) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.chapter.delete({ where: { id } });

  // Re-pack order values so they stay 0..n-1.
  const remaining = await prisma.chapter.findMany({
    where: { projectId: chapter.projectId },
    orderBy: { order: "asc" },
  });
  await Promise.all(
    remaining.map((ch, i) =>
      prisma.chapter.update({ where: { id: ch.id }, data: { order: i } })
    )
  );

  return NextResponse.json({ ok: true });
}
