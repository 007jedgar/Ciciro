import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError, responseFromDbError } from "@/lib/auth/http";
import { listShareComments } from "@/lib/shares";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

// GET /api/projects/:id/share-comments?chapterId=&status=open|resolved — reader
// comments, newest first, each with where its passage is in the text now.
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser(req);
  const query = req.nextUrl.searchParams;
  try {
    const comments = await listShareComments(id, user, {
      chapterId: query.get("chapterId") ?? undefined,
      status: query.get("status") ?? undefined,
    });
    return NextResponse.json({ comments });
  } catch (error) {
    const response = responseFromAuthError(error) ?? responseFromDbError(error);
    if (response) return response;
    throw error;
  }
}
