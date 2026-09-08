import { PrismaClient } from "@prisma/client";
import { PrismaD1 } from "@prisma/adapter-d1";
import { getD1Database } from "@/lib/d1-binding";

// Reuse a single Prisma client across hot reloads in Node. On Cloudflare the
// D1 binding is published per-request by the worker entry; we construct the
// adapter client lazily so module evaluation does not race that publish.
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  d1Prisma?: PrismaClient;
};

function createNodePrisma(): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

function getPrisma(): PrismaClient {
  const d1 = getD1Database();
  if (d1) {
    if (!globalForPrisma.d1Prisma) {
      globalForPrisma.d1Prisma = new PrismaClient({
        adapter: new PrismaD1(d1 as ConstructorParameters<typeof PrismaD1>[0]),
      });
    }
    return globalForPrisma.d1Prisma;
  }
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createNodePrisma();
  }
  return globalForPrisma.prisma;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getPrisma();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
