import { describe, expect, it, vi } from "vitest";
import { runWithRequestLifetime } from "@/worker/request-lifetime";

/** A stand-in for the Worker's ExecutionContext that keeps waitUntil promises. */
function workerContext() {
  const kept: Promise<unknown>[] = [];
  return {
    kept,
    ctx: {
      waitUntil: vi.fn((promise: Promise<unknown>) => {
        kept.push(promise);
      }),
      passThroughOnException: vi.fn(),
      props: { tenant: "t" },
    },
    /** Resolves once every waitUntil, including ones added late, has settled. */
    async drain() {
      for (let settled = -1; settled !== kept.length; ) {
        settled = kept.length;
        await Promise.allSettled(kept);
      }
    },
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("runWithRequestLifetime", () => {
  it("passes the handler a per-request context and finishes on that same object", async () => {
    const worker = workerContext();
    let seen: object | undefined;
    const finish = vi.fn(async () => {});

    const response = await runWithRequestLifetime(
      worker.ctx,
      async (requestCtx) => {
        seen = requestCtx;
        expect(requestCtx).not.toBe(worker.ctx);
        expect(requestCtx.props).toEqual({ tenant: "t" });
        requestCtx.passThroughOnException?.();
        return new Response("hello", { status: 201, headers: { "x-test": "1" } });
      },
      finish
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("x-test")).toBe("1");
    expect(await response.text()).toBe("hello");
    await worker.drain();
    expect(worker.ctx.passThroughOnException).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledWith(seen);
  });

  it("waits for a streamed body to finish before finishing", async () => {
    const worker = workerContext();
    const finish = vi.fn(async () => {});
    let push!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        push = controller;
      },
    });

    const response = await runWithRequestLifetime(worker.ctx, async () => new Response(body), finish);
    const reader = response.body!.getReader();

    push.enqueue(new TextEncoder().encode("chunk"));
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("chunk");
    await tick();
    expect(finish).not.toHaveBeenCalled();

    push.close();
    expect((await reader.read()).done).toBe(true);
    await worker.drain();
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it("finishes when the client cancels the body mid-stream", async () => {
    const worker = workerContext();
    const finish = vi.fn(async () => {});
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel: cancelled });

    const response = await runWithRequestLifetime(worker.ctx, async () => new Response(body), finish);
    await response.body!.cancel("client gone");
    await worker.drain();

    expect(cancelled).toHaveBeenCalled();
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it("waits for every waitUntil, including work registered by other background work", async () => {
    const worker = workerContext();
    const finish = vi.fn(async () => {});
    const first = deferred();
    const nested = deferred();

    await runWithRequestLifetime(
      worker.ctx,
      async (requestCtx) => {
        // Like Next's after(): background work that schedules more of itself.
        requestCtx.waitUntil(
          first.promise.then(() => {
            requestCtx.waitUntil(nested.promise);
          })
        );
        return new Response(null, { status: 204 });
      },
      finish
    );

    await tick();
    expect(finish).not.toHaveBeenCalled();
    first.resolve();
    await tick();
    expect(finish).not.toHaveBeenCalled();
    nested.resolve();
    await worker.drain();
    expect(finish).toHaveBeenCalledTimes(1);
    // Background work still reaches the real context so the runtime keeps it alive.
    expect(worker.ctx.waitUntil.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("still finishes after a rejected waitUntil", async () => {
    const worker = workerContext();
    const finish = vi.fn(async () => {});

    const response = await runWithRequestLifetime(
      worker.ctx,
      async (requestCtx) => {
        const failing = Promise.reject(new Error("background failed"));
        failing.catch(() => {});
        requestCtx.waitUntil(failing);
        return new Response("ok");
      },
      finish
    );
    await response.text();
    await worker.drain();

    expect(finish).toHaveBeenCalledTimes(1);
  });

  it("finishes when the handler throws, and rethrows", async () => {
    const worker = workerContext();
    const finish = vi.fn(async () => {});

    await expect(
      runWithRequestLifetime(
        worker.ctx,
        async () => {
          throw new Error("handler failed");
        },
        finish
      )
    ).rejects.toThrow("handler failed");
    await worker.drain();

    expect(finish).toHaveBeenCalledTimes(1);
  });

  it("logs instead of rejecting the waitUntil when cleanup fails", async () => {
    const worker = workerContext();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await runWithRequestLifetime(
      worker.ctx,
      async () => new Response("ok"),
      async () => {
        throw new Error("disconnect failed");
      }
    );
    await response.text();
    const results = await Promise.allSettled(worker.kept);

    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    expect(error).toHaveBeenCalledTimes(1);
  });
});
