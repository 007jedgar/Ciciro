import { AsyncLocalStorage } from "node:async_hooks";
import { PrismaClient } from "@prisma/client";
import { PrismaD1 } from "@prisma/adapter-d1";
import { getD1Database, runWithD1Database } from "@/lib/d1-binding";
import { cachedOnContext, REQUEST_PRISMA } from "@/lib/request-prisma";

// Node: one client across hot reloads.
// Workers: one Prisma client per request, cached on the request's
// ExecutionContext and freed when the request is over.
// The Worker entry and the OpenNext server bundle each load this module, so an
// ALS store set in the entry is invisible to route handlers. A single
// isolate-level client is visible, and concurrent requests then resolve each
// other's promises: the runtime cancels the continuation and the page never
// responds (Cloudflare 1101). Creating a client on every query instead OOMs
// login (loadEngine / Uint8Array.subarray), so the context cache is one client
// per request and the isolate client is only the fallback.
//
// Every client builds its own QueryEngine inside the isolate's one Prisma WASM
// instance, and nothing but $disconnect() (engine.free) reclaims it: garbage
// collection does not, and WASM memory never shrinks. An unfreed client per
// request leaks about 0.5 MB, so an isolate (128 MB) dies with "exceeded memory
// limit" after a few hundred requests. The Worker entry therefore calls
// disposeRequestPrisma once the body and all waitUntil / after() work are done
// (src/worker/request-lifetime.ts). Do not drop that call. Freeing too early is
// safe: a later query on a disconnected client reconnects.
const requestPrisma = new AsyncLocalStorage<PrismaClient>();

const CLOUDFLARE_CONTEXT = Symbol.for("__cloudflare-context__");

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  d1Prisma?: PrismaClient;
  warnedIsolatePrisma?: boolean;
};

function createNodePrisma(): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

function createD1Prisma(d1: unknown): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaD1(d1 as ConstructorParameters<typeof PrismaD1>[0]),
  });
}

// D1 cannot run interactive `prisma.$transaction(async (tx) => ...)`.
// Use sequential queries, or `prisma.$transaction([ ... ])` when every
// statement can be prepared up front.

type CloudflareContext = {
  env?: { DB?: unknown };
  ctx?: object;
};

function openNextContext(): CloudflareContext | undefined {
  try {
    const value = (globalThis as Record<symbol, unknown>)[CLOUDFLARE_CONTEXT];
    if (!value || typeof value !== "object") return undefined;
    return value as CloudflareContext;
  } catch {
    return undefined;
  }
}

/** The Prisma client cached on this request's OpenNext context, if any. */
function prismaForOpenNextRequest(): PrismaClient | undefined {
  const context = openNextContext();
  const d1 = context?.env?.DB;
  if (!context || d1 == null) return undefined;
  // Keyed on the ExecutionContext the Worker entry hands OpenNext, so the entry
  // can free this client when the request ends.
  return cachedOnContext(context.ctx ?? context, () => createD1Prisma(d1));
}

/** Free the Prisma client cached on a request's ExecutionContext, if any. */
export async function disposeRequestPrisma(key: object): Promise<void> {
  const box = key as Record<symbol, PrismaClient | undefined>;
  const client = box[REQUEST_PRISMA];
  if (!client) return;
  box[REQUEST_PRISMA] = undefined;
  await client.$disconnect();
}

/**
 * Free this request's client now, for a handler that is done with the database
 * but keeps a long-lived stream open. A later query builds a fresh client,
 * which the end of the request frees as usual. A no-op outside Workers.
 */
export async function releaseRequestPrisma(): Promise<void> {
  const context = openNextContext();
  if (context) await disposeRequestPrisma(context.ctx ?? context);
}

function onWorkers(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
}

function getPrisma(): PrismaClient {
  // Before the ALS store. runWithRequestPrisma used to put the isolate client
  // in ALS, and every concurrent request on that store shared it.
  const onRequest = prismaForOpenNextRequest();
  if (onRequest) return onRequest;

  const scoped = requestPrisma.getStore();
  if (scoped) return scoped;

  const d1 = getD1Database();
  if (d1) {
    if (!globalForPrisma.warnedIsolatePrisma && onWorkers()) {
      // Once per isolate: an HTTP request reaching here shares one client with
      // every concurrent request, which is what caused the 1101s.
      globalForPrisma.warnedIsolatePrisma = true;
      console.warn("[ciciro] Prisma fell back to the isolate-wide D1 client (no OpenNext request context)");
    }
    if (!globalForPrisma.d1Prisma) {
      globalForPrisma.d1Prisma = createD1Prisma(d1);
    }
    return globalForPrisma.d1Prisma;
  }
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createNodePrisma();
  }
  return globalForPrisma.prisma;
}

/**
 * Bind D1 for this Worker invocation. HTTP handlers do not share a Prisma
 * client here: they take one from the OpenNext request context inside
 * getPrisma. Scheduled work has no OpenNext context, so it gets a private
 * client for this invocation instead of the isolate fallback, freed when
 * `fn` settles.
 */
export async function runWithRequestPrisma<T>(d1: unknown, fn: () => Promise<T>): Promise<T> {
  const client = createD1Prisma(d1);
  try {
    return await runWithD1Database(d1, () => requestPrisma.run(client, fn));
  } finally {
    await client.$disconnect();
  }
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getPrisma();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
