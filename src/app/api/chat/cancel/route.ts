import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { authorizeProject } from "@/lib/auth/session";
import { responseFromAuthError } from "@/lib/auth/http";
import { cancelEditorRun } from "@/lib/editor-run";

export const runtime = "nodejs";

// POST /api/chat/cancel — ask a running editor turn to stop. Body:
// { projectId, turnId } or { projectId, runId }. Takes effect at the next
// safe iteration boundary (see cancelEditorRun / executeClaimedEditorRun);
// whatever already landed - visible text, committed tool mutations - stays,
// and remains undoable through the normal op log. Never a failure refund:
// the message that started this run was already metered when it was sent.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { projectId, turnId, runId } = body as {
    projectId?: string;
    turnId?: string;
    runId?: string;
  };
  if (!projectId || (!turnId?.trim() && !runId?.trim())) {
    return json({ error: "projectId and turnId or runId required" }, 400);
  }

  try {
    await authorizeProject(projectId, req);
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }

  const run = runId
    ? await prisma.editorRun.findUnique({ where: { id: runId } })
    : await prisma.editorRun.findUnique({ where: { turnId } });
  if (!run || run.projectId !== projectId) {
    return json({ error: "No matching editor run" }, 404);
  }

  const updated = await cancelEditorRun(run.id, projectId);
  if (!updated) return json({ error: "No matching editor run" }, 404);
  return json(
    { runId: updated.id, turnId: updated.turnId, status: updated.status },
    200
  );
}

function json(obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}
