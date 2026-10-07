import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError, responseFromDbError } from "@/lib/auth/http";
import { addKnowledgeFact, listKnowledgeFacts } from "@/lib/knowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/projects/:id/knowledge?characterPath=characters/<slug>.md&includeRetired=1
// characterPath omitted lists every character; includeRetired=1 adds superseded facts.
export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getSessionUser(req);
  const url = new URL(req.url);
  const characterPath = url.searchParams.get("characterPath") || undefined;
  const includeRetired = url.searchParams.get("includeRetired") === "1";
  try {
    return NextResponse.json({
      facts: await listKnowledgeFacts(id, user, { characterPath, includeRetired }),
    });
  } catch (error) {
    const failure = responseFromAuthError(error) ?? responseFromDbError(error);
    if (failure) return failure;
    throw error;
  }
}

// POST /api/projects/:id/knowledge — add a fact and refresh that character's mirror block.
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getSessionUser(req);
  const body = await req.json().catch(() => ({}));
  try {
    return NextResponse.json(await addKnowledgeFact(id, user, body), { status: 201 });
  } catch (error) {
    const failure = responseFromAuthError(error) ?? responseFromDbError(error);
    if (failure) return failure;
    throw error;
  }
}
