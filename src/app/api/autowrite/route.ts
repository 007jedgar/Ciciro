import { NextRequest } from "next/server";
import { runAutoWrite } from "@/lib/autowrite";
import { getAnthropic } from "@/lib/anthropic";
import { ensureBible } from "@/lib/bible";

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
  try {
    getAnthropic();
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
  await ensureBible(projectId);

  let stopped = false;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          /* controller closed */
        }
      };
      // Keepalives so a quiet planning/drafting stretch doesn't look like a dead link.
      const pingTimer = setInterval(() => emit({ type: "ping" }), 12_000);
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
        controller.close();
      }
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
