import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError } from "@/lib/auth/http";
import { addProjectsToFolder, removeProjectsFromFolder } from "@/lib/folders";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

// POST /api/folders/:id/projects — file manuscripts into this folder.
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser(req);
  const body = await req.json().catch(() => ({}));
  try {
    const folder = await addProjectsToFolder(id, user, body);
    return NextResponse.json(folder);
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
}

// DELETE /api/folders/:id/projects — unfile manuscripts (body or ?projectId=).
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getSessionUser(req);
  const url = req.nextUrl;
  let body: { projectIds?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    const ids = url.searchParams.getAll("projectId");
    if (ids.length) body = { projectIds: ids };
  }
  try {
    const folder = await removeProjectsFromFolder(id, user, body);
    return NextResponse.json(folder);
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
}
