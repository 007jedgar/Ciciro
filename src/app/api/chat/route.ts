import { NextRequest } from "next/server";
import { getAnthropic } from "@/lib/anthropic";
import { prisma } from "@/lib/db";
import { maybeCompactChat } from "@/lib/compact";
import {
  claimEditorRun,
  executeClaimedEditorRun,
  prepareEditorRun,
  type EditorRunInput,
  type EditorRunStatus,
} from "@/lib/editor-run";
import { getRunCoordinator } from "@/lib/durable/coordinator";

export const runtime = "nodejs";
export const maxDuration = 600;

const PING_MS = 12_000;
// Held for one slice; longer than a slice, shorter than the DB lease so a dead
// worker's Durable Object lock self-clears via its alarm before the DB lease.
const RUN_LOCK_TTL_MS = 12 * 60_000;

// POST /api/chat — thin NDJSON adapter over the durable editor runner.
// A done event reports the durable run state; only `completed` means the
// author's request passed the completion gate.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const input = body as EditorRunInput & { compactOnly?: boolean };

  if (!input.projectId) {
    return json({ error: "projectId required" }, 400);
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

  const { run, compactNotice } = prepared;
  const status = run.status as EditorRunStatus;
  if (
    status === "completed" ||
    status === "failed" ||
    status === "cancelled"
  ) {
    return replayRun({
      id: run.id,
      turnId: run.turnId,
      visibleOutput: run.visibleOutput,
      status,
      stopReason: run.stopReason,
    });
  }

  // Durable-Object (or in-process) single-writer gate in front of the DB lease.
  // On Cloudflare this serializes slices fleet-wide; locally it is a fast
  // in-process guard. The DB lease remains the cross-process source of truth.
  const coordinator = getRunCoordinator();
  const runLease = await coordinator.acquire(run.id, RUN_LOCK_TTL_MS);
  if (!runLease) {
    return json(
      {
        error: "Editor run is already executing",
        turnId: run.turnId,
        runId: run.id,
        status: run.status,
      },
      409
    );
  }

  const claim = await claimEditorRun(run.id);
  if (!claim) {
    await coordinator.release(run.id, runLease.token);
    const latest = await prisma.editorRun.findUnique({ where: { id: run.id } });
    if (
      latest &&
      ["completed", "failed", "cancelled"].includes(latest.status)
    ) {
      return replayRun({
        id: latest.id,
        turnId: latest.turnId,
        visibleOutput: latest.visibleOutput,
        status: latest.status as EditorRunStatus,
        stopReason: latest.stopReason,
      });
    }
    return json(
      {
        error: "Editor run is already executing",
        turnId: run.turnId,
        runId: run.id,
        status: latest?.status || run.status,
      },
      409
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const emit = (event: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          closed = true;
        }
      };
      const pingTimer = setInterval(() => emit({ type: "ping" }), PING_MS);

      emit({ type: "turn", id: claim.turnId, runId: claim.id });
      emit({
        type: "phase",
        status: claim.status,
        runId: claim.id,
        stopReason: claim.stopReason,
        iterationCount: claim.iterationCount,
        mutationCount: claim.mutationCount,
      });
      if (compactNotice) emit({ type: "tool", v: compactNotice });
      if (claim.visibleOutput) {
        emit({
          type: "text",
          v: claim.visibleOutput,
          resume: true,
        });
      }

      let final: {
        id: string;
        status: string;
        stopReason: string | null;
        iterationCount: number;
        mutationCount: number;
      } = claim;
      try {
        final = await executeClaimedEditorRun(claim, emit);
      } finally {
        clearInterval(pingTimer);
        await coordinator.release(run.id, runLease.token);
        emit({
          type: "done",
          status: final.status,
          runId: final.id,
          stopReason: final.stopReason,
          iterationCount: final.iterationCount,
          mutationCount: final.mutationCount,
        });
        try {
          controller.close();
        } catch {
          // The client may have disconnected; the run was still persisted.
        }
        closed = true;
      }
    },
    cancel() {
      // Disconnect is not cancellation. The claimed slice continues and
      // checkpoints server-side; explicit cancellation is a later API phase.
    },
  });

  return ndjson(stream);
}

function replayRun(run: {
  id: string;
  turnId: string;
  visibleOutput: string;
  status: EditorRunStatus;
  stopReason: string | null;
}) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const emit = (event: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      emit({ type: "turn", id: run.turnId, runId: run.id });
      if (run.visibleOutput) {
        emit({ type: "text", v: run.visibleOutput, resume: true });
      }
      emit({
        type: "done",
        status: run.status,
        runId: run.id,
        stopReason: run.stopReason,
      });
      controller.close();
    },
  });
  return ndjson(stream);
}

function ndjson(stream: ReadableStream<Uint8Array>) {
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
    },
  });
}

// GET /api/chat?projectId=... — load chat plus durable run summaries. The
// client uses these authoritative states to resume safely after reload.
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return json({ error: "projectId required" }, 400);
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
  await prisma.$transaction([
    prisma.editorRun.deleteMany({ where: { projectId } }),
    prisma.chatBlob.deleteMany({ where: { projectId } }),
    prisma.draftInsertion.deleteMany({ where: { projectId } }),
    prisma.chatMessage.deleteMany({ where: { projectId } }),
  ]);
  return json({ ok: true }, 200);
}

function json(obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}
