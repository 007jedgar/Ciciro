import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError, responseFromDbError } from "@/lib/auth/http";
import {
  deleteManuscriptTarget,
  getManuscriptTarget,
  putManuscriptTarget,
} from "@/lib/manuscript-target-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function jsonTarget(target: NonNullable<Awaited<ReturnType<typeof getManuscriptTarget>>>) {
  return NextResponse.json({
    target: {
      projectId: target.projectId,
      wordGoal: target.wordGoal,
      deadline: target.deadline,
      manuscriptWords: target.manuscriptWords,
      pace: target.pace,
    },
  });
}

// GET /api/projects/[id]/target
export async function GET(req: NextRequest, ctx: Ctx) {
  const user = await getSessionUser(req);
  const { id } = await ctx.params;
  try {
    const target = await getManuscriptTarget(user, id);
    if (!target) return NextResponse.json({ target: null });
    return jsonTarget(target);
  } catch (error) {
    const failure = responseFromAuthError(error) ?? responseFromDbError(error);
    if (failure) return failure;
    throw error;
  }
}

// PUT /api/projects/[id]/target
export async function PUT(req: NextRequest, ctx: Ctx) {
  const user = await getSessionUser(req);
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  try {
    const target = await putManuscriptTarget(user, id, body);
    return jsonTarget(target);
  } catch (error) {
    const failure = responseFromAuthError(error) ?? responseFromDbError(error);
    if (failure) return failure;
    throw error;
  }
}

// DELETE /api/projects/[id]/target
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const user = await getSessionUser(req);
  const { id } = await ctx.params;
  try {
    await deleteManuscriptTarget(user, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const failure = responseFromAuthError(error) ?? responseFromDbError(error);
    if (failure) return failure;
    throw error;
  }
}
