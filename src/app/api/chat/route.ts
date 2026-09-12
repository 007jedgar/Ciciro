import { NextRequest } from "next/server";
import { getAnthropic } from "@/lib/anthropic";
import { prisma } from "@/lib/db";
import { authorizeProject } from "@/lib/auth/session";
import { responseFromAuthError } from "@/lib/auth/http";
import { maybeCompactChat } from "@/lib/compact";
import {
  prepareEditorRun,
  type EditorRunInput,
} from "@/lib/editor-run";
import {
  json,
  streamEditorRunSlice,
} from "@/lib/editor-run-http";

export const runtime = "nodejs";
export const maxDuration = 600;

// POST /api/chat — thin NDJSON adapter over the durable editor runner.
// A done event reports the durable run state; only `completed` means the
// author's request passed the completion gate.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const input = body as EditorRunInput & { compactOnly?: boolean };

  if (!input.projectId) {
    return json({ error: "projectId required" }, 400);
  }

  try {
    await authorizeProject(input.projectId);
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }

  if (input.compactOnly) {
    try {
      getAnthropic();
      const result = await maybeCompactChat(input.projectId, true);
      return json(result, 200);
    } catch (error) {
      return json({ error: (error as Error).message }, 500);
    }
  }

  if (!input.resumeTurnId && !input.message?.trim()) {
    return json({ error: "projectId and message required" }, 400);
  }

  try {
    getAnthropic();
  } catch (error) {
    return json({ error: (error as Error).message }, 500);
  }

  let prepared;
  try {
    prepared = await prepareEditorRun(input);
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

// GET /api/chat?projectId=... — load chat plus durable run summaries. The
// client uses these authoritative states to resume safely after reload.
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return json({ error: "projectId required" }, 400);
  try {
    await authorizeProject(projectId);
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
  const [messages, runs] = await Promise.all([
    prisma.chatMessage.findMany({
      where: { projectId, archivedAt: null },
      orderBy: { createdAt: "asc" },
      take: 200,
    }),
    prisma.editorRun.findMany({
      where: { projectId },
      orderBy: { createdAt: "asc" },
      take: 200,
      select: {
        id: true,
        projectId: true,
        turnId: true,
        userMessageId: true,
        assistantMessageId: true,
        kind: true,
        scope: true,
        activeChapterId: true,
        selection: true,
        autoMode: true,
        status: true,
        visibleOutput: true,
        iterationCount: true,
        mutationCount: true,
        stopReason: true,
        verificationJson: true,
        error: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  ]);
  return json({ messages, runs }, 200);
}

// DELETE /api/chat?projectId=... — hard-clear chat and its durable runs.
export async function DELETE(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return json({ error: "projectId required" }, 400);
  try {
    await authorizeProject(projectId);
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
  await prisma.$transaction([
    prisma.editorRun.deleteMany({ where: { projectId } }),
    prisma.chatBlob.deleteMany({ where: { projectId } }),
    prisma.draftInsertion.deleteMany({ where: { projectId } }),
    prisma.chatMessage.deleteMany({ where: { projectId } }),
  ]);
  return json({ ok: true }, 200);
}
