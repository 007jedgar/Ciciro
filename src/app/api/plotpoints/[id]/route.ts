import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const data: Record<string, string | null> = {};
  for (const key of ["title", "description", "type", "status"] as const) {
    if (typeof body[key] === "string") data[key] = body[key];
  }
  if ("chapterId" in body) data.chapterId = body.chapterId || null;
  const point = await prisma.plotPoint.update({ where: { id }, data });
  return NextResponse.json(point);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  await prisma.plotPoint.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
