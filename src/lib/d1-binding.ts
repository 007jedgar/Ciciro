// The worker entry publishes its D1 binding here so Prisma can reach it
// without importing Cloudflare-only modules at Next/test build time.

const globalForD1 = globalThis as unknown as { __ciciroD1__?: unknown };

/** Register the D1 database (called from the worker entry). */
export function setD1Database(db: unknown): void {
  globalForD1.__ciciroD1__ = db;
}

/** The D1 binding, or undefined on Node / tests. */
export function getD1Database(): unknown {
  return globalForD1.__ciciroD1__;
}
