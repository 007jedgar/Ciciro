import { AsyncLocalStorage } from "node:async_hooks";
import { PrismaClient } from "@prisma/client";
import { PrismaD1 } from "@prisma/adapter-d1";
import { getD1Database, runWithD1Database } from "@/lib/d1-binding";
import { cachedOnContext } from "@/lib/request-prisma";

// Node: one client across hot reloads.
// Workers: one Prisma client per request, cached on OpenNext's request context.
// The Worker entry and the OpenNext server bundle each load this module, so an
// ALS store set in the entry is invisible to route handlers. A single
// isolate-level client is visible, and concurrent requests then resolve each
// other's promises — the runtime cancels the continuation and the page never
// responds (Cloudflare 1101). Creating a client on every query instead OOMs
// login (loadEngine / Uint8Array.subarray), so the context cache is one client
// per request and the isolate client is only the fallback.
const requestPrisma = new AsyncLocalStorage<PrismaClient>();

const CLOUDFLARE_CONTEXT = Symbol.for("__cloudflare-context__");

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  d1Prisma?: PrismaClient;
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
  return cachedOnContext(context, () => createD1Prisma(d1));
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
 * client for this invocation instead of the isolate fallback.
 */
export function runWithRequestPrisma<T>(d1: unknown, fn: () => T): T {
  const client = createD1Prisma(d1);
  return runWithD1Database(d1, () => requestPrisma.run(client, fn));
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getPrisma();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
