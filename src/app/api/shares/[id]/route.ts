import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError, responseFromDbError } from "@/lib/auth/http";
import { deleteShareLink, updateShareLink } from "@/lib/shares";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

function failure(error: unknown): NextResponse {
  const response = responseFromAuthError(error) ?? responseFromDbError(error);
  if (response) return response;
  throw error;
}

// PATCH /api/shares/:id — rename or revoke a link. Body: { label?: string, revoke?: true }.
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser(req);
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  try {
    const link = await updateShareLink(id, user, {
      label: typeof body.label === "string" ? body.label : undefined,
      revoke: body.revoke === true ? true : undefined,
    });
    return NextResponse.json(link);
  } catch (error) {
    return failure(error);
  }
}

// DELETE /api/shares/:id — delete a link and the comments left through it.
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser(req);
  try {
    return NextResponse.json(await deleteShareLink(id, user));
  } catch (error) {
    return failure(error);
  }
}
