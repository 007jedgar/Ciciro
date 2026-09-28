import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError } from "@/lib/auth/http";
import { recordAiInvolvement } from "@/lib/chapters";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

// POST /api/chapters/:id/ai-involvement — add this action's word count to the
// chapter's AI-involvement tally. Body: { acceptedWords?, draftedWords? },
// each the words from one accept or one insert, not a running total. Best
// effort: a dropped call under-counts a self-report figure, it does not
// corrupt anything, so this never blocks the manuscript write it follows.
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser(req);
  const body = await req.json().catch(() => ({}));
  const { acceptedWords, draftedWords } = body as {
    acceptedWords?: number;
    draftedWords?: number;
  };
  try {
    await recordAiInvolvement(id, user, { acceptedWords, draftedWords });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
}
