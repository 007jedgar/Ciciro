import { afterEach, describe, expect, it, vi } from "vitest";
import { cachedOnContext } from "@/lib/request-prisma";

const { FakePrismaClient, clients } = vi.hoisted(() => {
  const clients: FakePrismaClient[] = [];
  class FakePrismaClient {
    options: { adapter?: unknown };
    $disconnect = vi.fn(async () => {});
    constructor(options: { adapter?: unknown } = {}) {
      this.options = options;
      clients.push(this);
    }
  }
  return { FakePrismaClient, clients };
});

vi.mock("@prisma/client", () => ({ PrismaClient: FakePrismaClient }));
vi.mock("@prisma/adapter-d1", () => ({
  PrismaD1: class {
    constructor(readonly d1: unknown) {}
  },
}));

import {
  disposeRequestPrisma,
  prisma,
  releaseRequestPrisma,
  runWithRequestPrisma,
  waitUntilRequest,
} from "@/lib/db";
import { setD1Database } from "@/lib/d1-binding";

const CLOUDFLARE_CONTEXT = Symbol.for("__cloudflare-context__");
const globals = globalThis as Record<PropertyKey, unknown>;

/** Identifies the client the `prisma` proxy resolves to right now. */
function resolvedClient(): unknown {
  // The proxy binds functions per call, so compare a plain property instead.
  return (prisma as unknown as { options: unknown }).options;
}

function onRequest<T>(context: object, fn: () => T): T {
  globals[CLOUDFLARE_CONTEXT] = context;
  try {
    return fn();
  } finally {
    delete globals[CLOUDFLARE_CONTEXT];
  }
}

afterEach(() => {
  clients.length = 0;
  delete globals[CLOUDFLARE_CONTEXT];
  delete globals.prisma;
  delete globals.d1Prisma;
  delete globals.warnedIsolatePrisma;
  delete globals.warnedLatePrisma;
  setD1Database(undefined);
  vi.unstubAllGlobals();
});

describe("cachedOnContext", () => {
  it("reuses one value for a request and isolates concurrent requests", () => {
    const first = {};
    const second = {};
    const created: string[] = [];
    const create = (label: string) => () => {
      created.push(label);
      return { label };
    };

    expect(cachedOnContext(first, create("a"))).toEqual({ label: "a" });
    expect(cachedOnContext(first, create("a-again"))).toEqual({ label: "a" });
    expect(cachedOnContext(second, create("b"))).toEqual({ label: "b" });
    expect(created).toEqual(["a", "b"]);
  });

  it("returns undefined when there is no request context", () => {
    expect(cachedOnContext(undefined, () => ({ label: "x" }))).toBeUndefined();
    expect(cachedOnContext(null, () => ({ label: "x" }))).toBeUndefined();
  });
});

describe("prisma on Workers", () => {
  it("gives each request context its own client, built once per request", () => {
    const first = { env: { DB: { id: "db" } }, ctx: {} };
    const second = { env: { DB: { id: "db" } }, ctx: {} };

    const a1 = onRequest(first, resolvedClient);
    const a2 = onRequest(first, resolvedClient);
    const b = onRequest(second, resolvedClient);

    expect(clients).toHaveLength(2);
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
    expect(clients.every((client) => client.options.adapter)).toBe(true);
  });

  it("keys the client on the request's ExecutionContext and frees it once", async () => {
    const ctx = {};
    onRequest({ env: { DB: {} }, ctx }, resolvedClient);
    expect(clients).toHaveLength(1);

    await disposeRequestPrisma(ctx);
    await disposeRequestPrisma(ctx);
    expect(clients[0].$disconnect).toHaveBeenCalledTimes(1);

    // A late query after disposal builds a fresh client instead of failing.
    onRequest({ env: { DB: {} }, ctx }, resolvedClient);
    expect(clients).toHaveLength(2);
  });

  it("lets a long-lived handler release its client early, and frees a later one at the end", async () => {
    const ctx = {};
    const context = { env: { DB: {} }, ctx };
    onRequest(context, resolvedClient);

    globals[CLOUDFLARE_CONTEXT] = context;
    await releaseRequestPrisma();
    delete globals[CLOUDFLARE_CONTEXT];
    expect(clients[0].$disconnect).toHaveBeenCalledTimes(1);

    onRequest(context, resolvedClient);
    await disposeRequestPrisma(ctx);
    expect(clients).toHaveLength(2);
    expect(clients[1].$disconnect).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the request never touched Prisma", async () => {
    await expect(disposeRequestPrisma({})).resolves.toBeUndefined();
    expect(clients).toHaveLength(0);
  });

  it("gives scheduled work a private client and frees it when the job settles", async () => {
    const d1 = { id: "cron" };
    await runWithRequestPrisma(d1, async () => {
      resolvedClient();
    });
    expect(clients).toHaveLength(1);
    expect(clients[0].$disconnect).toHaveBeenCalledTimes(1);

    await expect(
      runWithRequestPrisma(d1, async () => {
        resolvedClient();
        throw new Error("job failed");
      })
    ).rejects.toThrow("job failed");
    expect(clients).toHaveLength(2);
    expect(clients[1].$disconnect).toHaveBeenCalledTimes(1);
  });

  it("forwards waitUntilRequest to the request's ExecutionContext", () => {
    const waitUntil = vi.fn();
    const work = Promise.resolve();
    onRequest({ env: { DB: {} }, ctx: { waitUntil } }, () => waitUntilRequest(work));
    expect(waitUntil).toHaveBeenCalledWith(work);
  });

  it("logs once per isolate when a client is built on a disposed request", async () => {
    vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = { env: { DB: {} }, ctx: {} };
    const second = { env: { DB: {} }, ctx: {} };

    onRequest(first, resolvedClient);
    await disposeRequestPrisma(first.ctx);
    expect(warn).not.toHaveBeenCalled();

    onRequest(first, resolvedClient);
    await disposeRequestPrisma(second.ctx);
    onRequest(second, resolvedClient);

    expect(clients).toHaveLength(3);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("after its request was disposed");
  });

  it("does not log a client rebuilt after releaseRequestPrisma", async () => {
    vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const context = { env: { DB: {} }, ctx: {} };

    onRequest(context, resolvedClient);
    globals[CLOUDFLARE_CONTEXT] = context;
    await releaseRequestPrisma();
    delete globals[CLOUDFLARE_CONTEXT];
    onRequest(context, resolvedClient);

    expect(clients).toHaveLength(2);
    expect(warn).not.toHaveBeenCalled();
  });

  it("logs once per isolate when a Worker request falls back to the isolate client", () => {
    vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setD1Database({ id: "worker" });

    const first = resolvedClient();
    const second = resolvedClient();

    expect(first).toBe(second);
    expect(clients).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("isolate-wide D1 client");
  });
});

describe("prisma on Node", () => {
  it("uses one Node client with no request context, and never logs the Workers fallback", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const first = resolvedClient();
    const second = resolvedClient();

    expect(first).toBe(second);
    expect(clients).toHaveLength(1);
    expect(clients[0].options.adapter).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it("treats releasing the request client as a no-op", async () => {
    resolvedClient();
    await releaseRequestPrisma();
    expect(clients[0].$disconnect).not.toHaveBeenCalled();
  });

  it("treats waitUntilRequest as a no-op without a request context", () => {
    expect(() => waitUntilRequest(Promise.resolve())).not.toThrow();
  });

  it("does not log the fallback for a D1 binding outside Workers", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setD1Database({ id: "local" });
    resolvedClient();
    expect(warn).not.toHaveBeenCalled();
  });
});
