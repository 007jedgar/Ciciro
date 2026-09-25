import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError } from "@/lib/auth/http";
import { searchProject } from "@/lib/project-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// GET /api/projects/:id/search?q=&matchCase=1&wholeWord=1 — every match across
// the manuscript's chapters, with a context snippet and where to jump to.
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser(req);
  const url = req.nextUrl.searchParams;
  try {
    const result = await searchProject(id, user, url.get("q") ?? "", {
      matchCase: url.get("matchCase") === "1",
      wholeWord: url.get("wholeWord") === "1",
    });
    return NextResponse.json(result);
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
}
