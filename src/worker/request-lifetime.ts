// Runs per-request cleanup only once a Worker request is truly over.
//
// A Worker request outlives its handler: the response body can keep streaming
// (chat, account export) and ctx.waitUntil work, including Next's after(),
// keeps running after the Response is returned. The cleanup (freeing this
// request's Prisma engine) waits for all of it.

type WaitUntilContext = {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException?(): void;
  props?: unknown;
};

/**
 * Call `handle` with a per-request ExecutionContext that records every
 * waitUntil, then call `finish` with that same object exactly once: after the
 * response body has finished or been cancelled and every recorded waitUntil
 * promise has settled, including ones added while the others ran.
 */
export async function runWithRequestLifetime(
  ctx: WaitUntilContext,
  handle: (requestCtx: WaitUntilContext) => Promise<Response>,
  finish: (requestCtx: WaitUntilContext) => Promise<void>
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

  let bodyDone: Promise<unknown> = Promise.resolve();
  try {
    const response = await handle(requestCtx);
    if (!response.body || (response as { webSocket?: unknown }).webSocket) {
      return response;
    }
    // Pipe through an identity stream so the end (or cancel) of the body is
    // observable here. pipeTo rejects when the client goes away mid-stream.
    const { readable, writable } = new TransformStream();
    bodyDone = response.body.pipeTo(writable).catch(() => {});
    return new Response(readable, response);
  } finally {
    ctx.waitUntil(afterRequest(bodyDone, pending, () => finish(requestCtx)));
  }
}

async function afterRequest(
  bodyDone: Promise<unknown>,
  pending: Promise<unknown>[],
  finish: () => Promise<void>
): Promise<void> {
  await bodyDone;
  // A settling promise can register more work (after() inside after()), so
  // keep going until a round adds nothing new.
  for (let settled = -1; settled !== pending.length; ) {
    settled = pending.length;
    await Promise.allSettled(pending);
  }
  try {
    await finish();
  } catch (error) {
    console.error("[ciciro] request cleanup failed", error);
  }
}
