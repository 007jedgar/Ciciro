import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/db";
import { countWords, htmlToText } from "@/lib/text";
import { summarizeChapter } from "@/lib/summarize";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/chapters/:id — save content, title, order, status, or summary.
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const data: Record<string, string | number> = {};

  if (typeof body.content === "string") {
    data.content = body.content;
    data.wordCount = countWords(htmlToText(body.content));
  }
  if (typeof body.title === "string") data.title = body.title;
  if (typeof body.summary === "string") data.summary = body.summary;
  if (typeof body.status === "string") data.status = body.status;
  if (typeof body.order === "number") data.order = body.order;

  const chapter = await prisma.chapter.update({ where: { id }, data });

  // Refresh the beat summary in the background - don't hold up the autosave.
  if (typeof body.content === "string") {
    after(() => summarizeChapter(id).catch(() => {}));
  }

  return NextResponse.json(chapter);
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
