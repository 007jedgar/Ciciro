import { AsyncLocalStorage } from "node:async_hooks";
import { PrismaClient } from "@prisma/client";
import { PrismaD1 } from "@prisma/adapter-d1";
import { getD1Database, runWithD1Database } from "@/lib/d1-binding";

// Node: one client across hot reloads. Workers: one client per request, stored
// in ALS so concurrent /api/projects + /api/folders + /api/chat do not share
// Prisma promises across Cloudflare request contexts.
const requestPrisma = new AsyncLocalStorage<PrismaClient>();

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
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

function getPrisma(): PrismaClient {
  const scoped = requestPrisma.getStore();
  if (scoped) return scoped;

  const d1 = getD1Database();
  if (d1) {
    // OpenNext often leaves ALS. Never reuse one D1 PrismaClient across
    // requests — that is what hung chat and the manuscript shelf.
    return createD1Prisma(d1);
  }
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createNodePrisma();
  }
  return globalForPrisma.prisma;
}

/** Bind a request-scoped Prisma client to this Worker request's D1. */
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
