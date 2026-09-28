import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError, responseFromDbError } from "@/lib/auth/http";
import { analyzeStyle } from "@/lib/style-analysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/projects/:id/style-analysis — a proposed style.md and character
// Voice sections drafted from a sample of the author's own chapters. Read
// only: nothing is written to the bible here. The author reviews the result
// and saves whichever pieces they accept through the existing POST /api/bible.
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getSessionUser(req);
  try {
    return NextResponse.json(await analyzeStyle(id, user));
  } catch (error) {
    const failure = responseFromAuthError(error) ?? responseFromDbError(error);
    if (failure) return failure;
    throw error;
  }
}
