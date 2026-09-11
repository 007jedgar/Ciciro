import { AsyncLocalStorage } from "node:async_hooks";

// Per-request D1 only. A module global is shared across concurrent Worker
// isolates' request contexts; Prisma then resolves queries on a finished
// request and Cloudflare cancels them (hung /api/chat, 500s on the shelf).

const store = new AsyncLocalStorage<unknown>();

/** Run `fn` with this request's D1 binding visible to Prisma. */
export function runWithD1Database<T>(db: unknown, fn: () => T): T {
  return store.run(db, fn);
}

/** @deprecated Use runWithD1Database. Kept so older callers typecheck. */
export function setD1Database(_db: unknown): void {}

/** The D1 binding for the current request, or undefined on Node / tests. */
export function getD1Database(): unknown {
  return store.getStore();
}
