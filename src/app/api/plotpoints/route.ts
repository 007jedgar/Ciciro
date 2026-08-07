import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// POST /api/plotpoints — add a plot point / open loop to track.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!body.projectId || !body.title?.trim()) {
    return NextResponse.json({ error: "projectId and title required" }, { status: 400 });
  }
  const count = await prisma.plotPoint.count({ where: { projectId: body.projectId } });
  const point = await prisma.plotPoint.create({
    data: {
      projectId: body.projectId,
      title: body.title.trim(),
      description: body.description?.trim() || "",
      type: body.type || "beat",
      status: body.status || "open",
      chapterId: body.chapterId || null,
      order: count,
    },
  });
  return NextResponse.json(point, { status: 201 });
}
