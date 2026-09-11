import { AsyncLocalStorage } from "node:async_hooks";

// Prefer a per-request ALS binding. OpenNext often continues the Next.js
// handler outside that ALS, so also keep the Worker `env.DB` object as a
// fallback. Sharing the binding is safe; sharing one PrismaClient is not.

const store = new AsyncLocalStorage<unknown>();

const globalForD1 = globalThis as unknown as { __ciciroD1__?: unknown };

/** Run `fn` with this request's D1 binding visible to Prisma. */
export function runWithD1Database<T>(db: unknown, fn: () => T): T {
  return store.run(db, fn);
}

/** Publish the Worker D1 binding for handlers that leave the ALS context. */
export function setD1Database(db: unknown): void {
  globalForD1.__ciciroD1__ = db;
}

/** The D1 binding for the current request, or the Worker fallback. */
export function getD1Database(): unknown {
  return store.getStore() ?? globalForD1.__ciciroD1__;
}
