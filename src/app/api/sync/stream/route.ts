import { NextRequest } from "next/server";
import { AuthError, authorizeProjectId, getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError, responseFromDbError } from "@/lib/auth/http";
import { prisma } from "@/lib/db";
import { subscribeChapterHeads, type ChapterHeadPoke } from "@/lib/chapter-poke";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Comfortably inside the NDJSON readers' 45s stall watchdog. */
const PING_MS = 20_000;

async function currentHeads(projectId: string): Promise<ChapterHeadPoke[]> {
  const chapters = await prisma.chapter.findMany({
    where: { projectId },
    select: { id: true, revision: true },
    orderBy: { order: "asc" },
  });
  return chapters.map((chapter) => ({
    chapterId: chapter.id,
    revision: chapter.revision,
  }));
}

function headsFrame(heads: ChapterHeadPoke[]) {
  return {
    type: "heads",
    chapters: heads.map((head) => ({ id: head.chapterId, revision: head.revision })),
  };
}

// GET /api/sync/stream?projectId= — an NDJSON poke channel. One line per frame:
// `{"type":"heads",...}` when a chapter head moves, `{"type":"ping"}` to keep
// the connection (and the reader's stall timer) alive. The client pulls through
// /api/sync as usual; this only tells it when there is a reason to.
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId") ?? "";
  const user = await getSessionUser(req);
  let opening: ChapterHeadPoke[];
  try {
    if (!projectId) throw new AuthError("projectId required", 400);
    await authorizeProjectId(projectId, user);
    opening = await currentHeads(projectId);
  } catch (error) {
    const failure = responseFromAuthError(error) ?? responseFromDbError(error);
    if (failure) return failure;
    throw error;
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let open = true;

  const stop = () => {
    open = false;
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = null;
    unsubscribe?.();
    unsubscribe = null;
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (frame: unknown) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(frame) + "\n"));
        } catch {
          // The reader went away between frames; stop pushing at a closed pipe.
          stop();
        }
      };

      // The opening frame is what makes a missed poke harmless: a phone that
      // was offline while the desk wrote learns the current revisions the
      // moment it reconnects, and converges without waiting for the next edit.
      emit(headsFrame(opening));

      unsubscribe = subscribeChapterHeads(projectId, (heads) => {
        emit(headsFrame(heads));
      });
      pingTimer = setInterval(() => emit({ type: "ping" }), PING_MS);

      const close = () => {
        stop();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      // A signal that aborted before we got here never fires the listener.
      if (req.signal.aborted) close();
      else req.signal.addEventListener("abort", close);
    },
    cancel() {
      stop();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
    },
  });
}
