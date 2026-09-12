import { NextRequest } from "next/server";
import { getAnthropic } from "@/lib/anthropic";
import { authorizeProject } from "@/lib/auth/session";
import { responseFromAuthError } from "@/lib/auth/http";
import { prepareAutoWriteRun } from "@/lib/autowrite";
import { json, streamEditorRunSlice } from "@/lib/editor-run-http";

export const runtime = "nodejs";
export const maxDuration = 600;

// POST /api/autowrite — start or resume an unattended chapter draft as a
// durable EditorRun (kind: autowrite). One bounded slice per request; the
// client continues while status is `continuing`. Stream shape matches /api/chat.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const projectId = typeof body.projectId === "string" ? body.projectId : "";
  const chapterId = typeof body.chapterId === "string" ? body.chapterId : "";
  const resumeTurnId =
    typeof body.resumeTurnId === "string" ? body.resumeTurnId.trim() : "";

  if (!projectId) {
    return json({ error: "projectId required" }, 400);
  }
  if (!resumeTurnId && !chapterId) {
    return json({ error: "projectId and chapterId required" }, 400);
  }

  try {
    await authorizeProject(projectId);
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }

  try {
    getAnthropic();
  } catch (error) {
    return json({ error: (error as Error).message }, 500);
  }

  let prepared;
  try {
    prepared = await prepareAutoWriteRun({
      projectId,
      chapterId,
      targetWords: body.targetWords,
      guidance: body.guidance,
      resumeTurnId: resumeTurnId || undefined,
      clientTurnId:
        typeof body.clientTurnId === "string" ? body.clientTurnId : undefined,
      continueFrom:
        typeof body.continueFrom === "string" ? body.continueFrom : undefined,
    });
  } catch (error) {
    return json({ error: (error as Error).message }, 500);
  }
  if (!prepared) {
    return json({ error: "Nothing to resume for that turn" }, 404);
  }

  return streamEditorRunSlice({
    run: prepared.run,
    compactNotice: prepared.compactNotice,
  });
}
