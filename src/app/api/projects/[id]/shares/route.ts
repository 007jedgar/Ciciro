import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError, responseFromDbError } from "@/lib/auth/http";
import { createShareLink, listShareLinks } from "@/lib/shares";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

function failure(error: unknown): NextResponse {
  const response = responseFromAuthError(error) ?? responseFromDbError(error);
  if (response) return response;
  throw error;
}

// GET /api/projects/:id/shares — the manuscript's beta reader links, newest first.
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser(req);
  try {
    return NextResponse.json({ links: await listShareLinks(id, user) });
  } catch (error) {
    return failure(error);
  }
}

// POST /api/projects/:id/shares — make a link.
// Body: { label?: string, chapterIds?: string[], expiresInDays?: number | null }.
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser(req);
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  try {
    const link = await createShareLink(id, user, {
      label: typeof body.label === "string" ? body.label : undefined,
      chapterIds: body.chapterIds as string[] | undefined,
      expiresInDays: body.expiresInDays as number | null | undefined,
    });
    return NextResponse.json(link, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}
