import { NextRequest, NextResponse } from "next/server";
import { authorizeProject } from "@/lib/auth/session";
import { responseFromAuthError } from "@/lib/auth/http";
import { restoreChat } from "@/lib/chat-history";

export const runtime = "nodejs";

// POST /api/chat/restore — undo one Clear, named by the `archivedAt` stamp the
// DELETE returned. Restoring by stamp leaves history `compact` archived alone.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    projectId?: unknown;
    archivedAt?: unknown;
  };
  const projectId = typeof body.projectId === "string" ? body.projectId : "";
  const archivedAt = typeof body.archivedAt === "string" ? body.archivedAt : "";
  if (!projectId || !archivedAt) {
    return NextResponse.json({ error: "projectId and archivedAt required" }, { status: 400 });
  }
  try {
    await authorizeProject(projectId, req);
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
  return NextResponse.json(await restoreChat(projectId, archivedAt));
}
