import { NextRequest } from "next/server";
import { runAutoWrite } from "@/lib/autowrite";
import { waitUntilRequest } from "@/lib/db";
import { getAnthropic } from "@/lib/anthropic";
import { authorizeProjectId, getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError } from "@/lib/auth/http";
import { ensureBible } from "@/lib/bible";
import { meterAiRun } from "@/lib/entitlements";
import { notifyAutowriteFinished } from "@/lib/push/run-finished";

export const runtime = "nodejs";
export const maxDuration = 800;

// POST /api/autowrite — run the autonomous drafting loop for one chapter and
// stream progress as newline-delimited JSON. Aborting the request (client
// AbortController) stops the loop after the current beat.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { projectId, chapterId } = body;
  const targetWords = clampInt(body.targetWords, 200, 4000, 600);
  const guidance = typeof body.guidance === "string" ? body.guidance.trim() : "";

  if (!projectId || !chapterId) {
    return json({ error: "projectId and chapterId required" }, 400);
  }
  const user = await getSessionUser(req);
  try {
    await authorizeProjectId(projectId, user);
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
  try {
    getAnthropic();
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
  try {
    await meterAiRun(user);
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
  await ensureBible(projectId);

  let stopped = false;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let disconnected = false;
      let completed = false;
      const emit = (event: Record<string, unknown>) => {
        if (event.type === "done") completed = true;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          disconnected = true;
        }
      };
      // Keepalives so a quiet planning/drafting stretch doesn't look like a dead link.
      const pingTimer = setInterval(() => emit({ type: "ping" }), 12_000);
      const execute = async () => {
        try {
          await runAutoWrite({
            projectId,
            chapterId,
            targetWords,
            guidance,
            emit,
            shouldStop: () => stopped,
          });
        } catch (e) {
          emit({ type: "error", v: (e as Error).message });
        } finally {
          clearInterval(pingTimer);
          // The "done" emit above already tried to reach the client: a
          // disconnect caught there (or earlier) means nobody was watching
          // this draft finish.
          if (disconnected && completed && user) {
            await notifyAutowriteFinished(user.id, projectId, chapterId);
          }
          try {
            controller.close();
          } catch {
            // The client may have disconnected; the chapter was still saved.
          }
        }
      };
      const work = execute();
      waitUntilRequest(work.catch(() => {}));
      await work;
    },
    cancel() {
      stopped = true;
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
    },
  });
}

function clampInt(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}

function json(obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}
