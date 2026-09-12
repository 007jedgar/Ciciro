import { prisma } from "@/lib/db";
import {
  claimEditorRun,
  executeClaimedEditorRun,
  type EditorRunStatus,
} from "@/lib/editor-run";
import { getRunCoordinator } from "@/lib/durable/coordinator";

const PING_MS = 12_000;
// Held for one slice; longer than a slice, shorter than the DB lease so a dead
// worker's Durable Object lock self-clears via its alarm before the DB lease.
const RUN_LOCK_TTL_MS = 12 * 60_000;

type RunSummary = {
  id: string;
  turnId: string;
  visibleOutput: string;
  status: string;
  stopReason: string | null;
  iterationCount?: number;
  mutationCount?: number;
};

/**
 * Adapter shared by `/api/chat` and `/api/autowrite`: replay a terminal run,
 * or claim one slice behind the coordinator and stream NDJSON until the
 * checkpoint. Client disconnect is not cancellation.
 */
export async function streamEditorRunSlice(opts: {
  run: RunSummary;
  compactNotice?: string | null;
}): Promise<Response> {
  const { run, compactNotice } = opts;
  const status = run.status as EditorRunStatus;
  if (
    status === "completed" ||
    status === "failed" ||
    status === "cancelled"
  ) {
    return replayEditorRun(run);
  }

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
      return replayEditorRun({
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

export function replayEditorRun(run: RunSummary) {
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

export function ndjson(stream: ReadableStream<Uint8Array>) {
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
    },
  });
}

export function json(obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}
