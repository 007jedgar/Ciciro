// Runs per-request cleanup only once a Worker request is truly over.
//
// A Worker request outlives its handler: the response body can keep streaming
// (chat, account export) and ctx.waitUntil work, including Next's after(),
// keeps running after the Response is returned. The cleanup (freeing this
// request's Prisma engine) waits for all of it.
//
// A client cancel ends the body here and is forwarded to the source, so a
// stream that should stop on disconnect (sync stream, account export) does. A
// stream producer that keeps querying after the client disconnects (chat,
// autowrite) must register that work with waitUntilRequest (src/lib/db.ts), or
// its client is freed mid-run and a fresh one leaks.
//
// A body is not guaranteed to finish or be cancelled: after some disconnects
// the runtime just stops reading it. Waiting on the body alone then hangs with
// no I/O left, workerd cancels the request ("code had hung") and the cleanup
// never runs. So once all recorded work has settled, a body that has passed
// no chunk for QUIET_MS also counts as over. The pending timer keeps the
// request alive until then. Tradeoff: a client that pauses reading a pulled
// stream (account export) for longer than that and then resumes makes the
// next pull build a fresh Prisma client nothing frees (db.ts logs it once).
// QUIET_MS stays under the 30 s Workers allows waitUntil work after a client
// disconnects, and above every stream's keepalive ping interval.

/** How long a body may pass no chunk, with nothing else pending, before the request counts as over. */
export const QUIET_MS = 25_000;

type WaitUntilContext = {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException?(): void;
  props?: unknown;
};

/**
 * Call `handle` with a per-request ExecutionContext that records every
 * waitUntil, then call `finish` with that same object exactly once: after the
 * response body has finished, been cancelled, or gone `quietMs` without passing
 * a chunk, and every recorded waitUntil promise has settled, including ones
 * added while the others ran.
 */
export async function runWithRequestLifetime(
  ctx: WaitUntilContext,
  handle: (requestCtx: WaitUntilContext) => Promise<Response>,
  finish: (requestCtx: WaitUntilContext) => Promise<void>,
  { quietMs = QUIET_MS }: { quietMs?: number } = {}
): Promise<Response> {
  const pending: Promise<unknown>[] = [];
  const requestCtx: WaitUntilContext = {
    waitUntil(promise) {
      pending.push(promise);
      ctx.waitUntil(promise);
    },
    passThroughOnException() {
      ctx.passThroughOnException?.();
    },
    get props() {
      return ctx.props;
    },
  };

  const body: BodyWatch = { done: true, finished: Promise.resolve(), lastChunkAt: Date.now() };
  try {
    const response = await handle(requestCtx);
    if (!response.body || (response as { webSocket?: unknown }).webSocket) {
      return response;
    }
    return new Response(watchBody(response.body, body), response);
  } finally {
    ctx.waitUntil(afterRequest(body, pending, quietMs, () => finish(requestCtx)));
  }
}

type BodyWatch = {
  done: boolean;
  finished: Promise<void>;
  lastChunkAt: number;
};

/**
 * Re-expose `source` so its end, a client cancel, and each chunk it passes are
 * observable in `watch`. A cancel counts at once: cancelling the OpenNext body
 * can stay pending forever.
 */
function watchBody(source: ReadableStream<Uint8Array>, watch: BodyWatch): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let markDone!: () => void;
  watch.done = false;
  watch.finished = new Promise<void>((resolve) => {
    markDone = () => {
      watch.done = true;
      resolve();
    };
  });
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await reader.read();
        if (done) {
          controller.close();
          markDone();
          return;
        }
        watch.lastChunkAt = Date.now();
        controller.enqueue(value);
      } catch (error) {
        controller.error(error);
        markDone();
      }
    },
    cancel(reason) {
      markDone();
      reader.cancel(reason).catch(() => {});
    },
  });
}

async function afterRequest(
  body: BodyWatch,
  pending: Promise<unknown>[],
  quietMs: number,
  finish: () => Promise<void>
): Promise<void> {
  for (;;) {
    // A settling promise can register more work (after() inside after()), so
    // keep going until a round adds nothing new.
    for (let settled = -1; settled !== pending.length; ) {
      settled = pending.length;
      await Promise.allSettled(pending);
    }
    if (body.done) break;
    const wait = body.lastChunkAt + quietMs - Date.now();
    if (wait <= 0) break;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([body.finished, new Promise((resolve) => (timer = setTimeout(resolve, wait)))]);
    clearTimeout(timer);
  }
  try {
    await finish();
  } catch (error) {
    console.error("[ciciro] request cleanup failed", error);
  }
}
