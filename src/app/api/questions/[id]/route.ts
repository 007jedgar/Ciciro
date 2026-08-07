import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/questions/:id — update answer/status/resolution/etc.
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const data: Record<string, string | null> = {};
  for (const key of ["question", "provisional", "affects", "answer", "resolution", "status"] as const) {
    if (typeof body[key] === "string") data[key] = body[key];
  }
  if ("chapterId" in body) data.chapterId = body.chapterId || null;
  const q = await prisma.openQuestion.update({ where: { id }, data });
  return json(q, 200);
}

// DELETE /api/questions/:id
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  await prisma.openQuestion.delete({ where: { id } });
  return json({ ok: true }, 200);
}

function json(obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}
