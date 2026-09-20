import { AsyncLocalStorage } from "node:async_hooks";
import { PrismaClient } from "@prisma/client";
import { PrismaD1 } from "@prisma/adapter-d1";
import { getD1Database, runWithD1Database } from "@/lib/d1-binding";

// Node: one client across hot reloads. Workers: prefer the request ALS client,
// and fall back to one isolate-level D1 client. OpenNext often leaves ALS;
// creating a new Prisma WASM engine per query OOMs login.
const requestPrisma = new AsyncLocalStorage<PrismaClient>();

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

function getPrisma(): PrismaClient {
  const scoped = requestPrisma.getStore();
  if (scoped) return scoped;

  const d1 = getD1Database();
  if (d1) {
    // OpenNext often leaves ALS. Spawning a new Prisma WASM engine on every
    // query OOMs the Worker (login 500s, loadEngine / Uint8Array.subarray).
    // Reuse one isolate client for the stable env.DB binding.
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

/** Bind this request to the isolate D1 Prisma client (and ALS when it sticks). */
export function runWithRequestPrisma<T>(d1: unknown, fn: () => T): T {
  if (!globalForPrisma.d1Prisma) {
    globalForPrisma.d1Prisma = createD1Prisma(d1);
  }
  const client = globalForPrisma.d1Prisma;
  return runWithD1Database(d1, () => requestPrisma.run(client, fn));
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getPrisma();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
