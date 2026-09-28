import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError } from "@/lib/auth/http";
import { repetitionReportForProject } from "@/lib/repetition-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// GET /api/projects/:id/repetition — overused words and phrases, per chapter
// and across the manuscript. Deterministic: no LLM call, so this is cheap
// enough to run on demand.
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser(req);
  try {
    const report = await repetitionReportForProject(id, user);
    return NextResponse.json(report);
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
}
