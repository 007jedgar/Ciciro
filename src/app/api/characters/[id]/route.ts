import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

const EDITABLE = ["name", "role", "description", "arc", "notes"] as const;

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const data: Record<string, string> = {};
  for (const key of EDITABLE) {
    if (typeof body[key] === "string") data[key] = body[key];
  }
  const character = await prisma.character.update({ where: { id }, data });
  return NextResponse.json(character);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  await prisma.character.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
