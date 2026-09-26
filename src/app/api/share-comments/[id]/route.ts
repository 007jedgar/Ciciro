import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError, responseFromDbError } from "@/lib/auth/http";
import { deleteShareComment, setShareCommentStatus } from "@/lib/shares";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

function failure(error: unknown): NextResponse {
  const response = responseFromAuthError(error) ?? responseFromDbError(error);
  if (response) return response;
  throw error;
}

// PATCH /api/share-comments/:id — resolve or reopen. Body: { status: "open" | "resolved" }.
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser(req);
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  try {
    return NextResponse.json(await setShareCommentStatus(id, user, body.status));
  } catch (error) {
    return failure(error);
  }
}

// DELETE /api/share-comments/:id — forget a reader comment.
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser(req);
  try {
    return NextResponse.json(await deleteShareComment(id, user));
  } catch (error) {
    return failure(error);
  }
}
