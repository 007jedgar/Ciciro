import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError } from "@/lib/auth/http";
import { deleteFolder, getFolder, updateFolder } from "@/lib/folders";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

// GET /api/folders/:id — folder with its manuscripts.
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser(req);
  try {
    const folder = await getFolder(id, user);
    return NextResponse.json(folder);
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
}

// PATCH /api/folders/:id — rename or update notes.
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser(req);
  const body = await req.json().catch(() => ({}));
  try {
    const folder = await updateFolder(id, user, body);
    return NextResponse.json(folder);
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
}

// DELETE /api/folders/:id — remove the folder; manuscripts stay, unfiled.
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser(req);
  try {
    const result = await deleteFolder(id, user);
    return NextResponse.json(result);
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
}
