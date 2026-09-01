// Single-writer coordination for durable editor run slices.
//
// A run must never execute two slices at once. The database lease
// (EditorRun.lockToken/leaseExpiresAt) is the durable source of truth across
// process death; this coordinator is a fast, in-region gate in front of it.
//
// - Locally (Node) the InProcessCoordinator serializes slices inside one
//   process, which is all a single Node server needs.
// - On Cloudflare, a Durable Object gives one authoritative serialization point
//   per run across the whole fleet (see src/worker/run-do.ts). The
//   DurableObjectsCoordinator forwards to it.
//
// getRunCoordinator() picks the DO-backed implementation when a binding has
// been published on globalThis by the worker entry, and falls back to
// in-process otherwise, so the Node build and tests keep working unchanged.

export type RunLease = {
  token: string;
  expiresAt: number;
};

export interface RunCoordinator {
  /** Acquire the lock for a run, or null when another holder is active. */
  acquire(runId: string, ttlMs: number): Promise<RunLease | null>;
  /** Extend a held lease. Returns false if the token no longer owns the lock. */
  renew(runId: string, token: string, ttlMs: number): Promise<boolean>;
  /** Release a held lock. No-op if the token is stale. */
  release(runId: string, token: string): Promise<void>;
}

function newToken(): string {
  // crypto.randomUUID exists in Node 18+ and the Workers runtime.
  return crypto.randomUUID();
}

/**
 * Process-local coordinator. A held lock is keyed by runId with an expiry so a
 * crashed slice cannot wedge the run forever.
 */
export class InProcessCoordinator implements RunCoordinator {
  private locks = new Map<string, RunLease>();

  private live(runId: string, now: number): RunLease | null {
    const held = this.locks.get(runId);
    if (!held) return null;
    if (held.expiresAt <= now) {
      this.locks.delete(runId);
      return null;
    }
    return held;
  }

  async acquire(runId: string, ttlMs: number): Promise<RunLease | null> {
    const now = Date.now();
    if (this.live(runId, now)) return null;
    const lease: RunLease = { token: newToken(), expiresAt: now + ttlMs };
    this.locks.set(runId, lease);
    return lease;
  }

  async renew(runId: string, token: string, ttlMs: number): Promise<boolean> {
    const held = this.live(runId, Date.now());
    if (!held || held.token !== token) return false;
    held.expiresAt = Date.now() + ttlMs;
    return true;
  }

  async release(runId: string, token: string): Promise<void> {
    const held = this.locks.get(runId);
    if (held && held.token === token) this.locks.delete(runId);
  }
}

// Minimal shape of a Durable Object namespace binding. Declared locally so this
// module typechecks in a plain Node build without @cloudflare/workers-types.
export interface RunDurableObjectNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(input: string, init?: RequestInit): Promise<Response> };
}

/**
 * Cloudflare-backed coordinator. Each run maps to one Durable Object instance,
 * so acquire/renew/release are serialized by the DO's single-threaded model.
 */
export class DurableObjectsCoordinator implements RunCoordinator {
  constructor(private ns: RunDurableObjectNamespace) {}

  private stub(runId: string) {
    return this.ns.get(this.ns.idFromName(runId));
  }

  private async call(runId: string, path: string, body: unknown): Promise<Response> {
    return this.stub(runId).fetch(`https://run/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async acquire(runId: string, ttlMs: number): Promise<RunLease | null> {
    const res = await this.call(runId, "acquire", { ttlMs });
    if (res.status === 409) return null;
    if (!res.ok) throw new Error(`Run coordinator acquire failed: ${res.status}`);
    return (await res.json()) as RunLease;
  }

  async renew(runId: string, token: string, ttlMs: number): Promise<boolean> {
    const res = await this.call(runId, "renew", { token, ttlMs });
    if (!res.ok) return false;
    const data = (await res.json()) as { renewed: boolean };
    return Boolean(data.renewed);
  }

  async release(runId: string, token: string): Promise<void> {
    await this.call(runId, "release", { token }).catch(() => {});
  }
}

// The worker entry publishes its DO namespace here so server code can reach it
// without importing Cloudflare-only modules at build time.
const globalForRuns = globalThis as unknown as {
  __ciciroRunNamespace__?: RunDurableObjectNamespace;
  __ciciroRunCoordinator__?: RunCoordinator;
};

/** Register the Durable Object namespace (called from the worker entry). */
export function setRunDurableObjectNamespace(ns: RunDurableObjectNamespace): void {
  globalForRuns.__ciciroRunNamespace__ = ns;
  globalForRuns.__ciciroRunCoordinator__ = new DurableObjectsCoordinator(ns);
}

/** Resolve the active coordinator (DO-backed on Cloudflare, else in-process). */
export function getRunCoordinator(): RunCoordinator {
  if (globalForRuns.__ciciroRunCoordinator__) {
    return globalForRuns.__ciciroRunCoordinator__;
  }
  if (globalForRuns.__ciciroRunNamespace__) {
    globalForRuns.__ciciroRunCoordinator__ = new DurableObjectsCoordinator(
      globalForRuns.__ciciroRunNamespace__
    );
    return globalForRuns.__ciciroRunCoordinator__;
  }
  const singleton =
    globalForRuns.__ciciroRunCoordinator__ ?? new InProcessCoordinator();
  globalForRuns.__ciciroRunCoordinator__ = singleton;
  return singleton;
}

export type WithRunLockResult<T> =
  | { locked: false; value: T }
  | { locked: true; value: null };

/**
 * Run `fn` while holding the run lock. Returns `{ locked: true }` without
 * calling `fn` when another holder is active. The lock is always released.
 */
export async function withRunLock<T>(
  runId: string,
  ttlMs: number,
  fn: (lease: RunLease) => Promise<T>,
  coordinator: RunCoordinator = getRunCoordinator()
): Promise<WithRunLockResult<T>> {
  const lease = await coordinator.acquire(runId, ttlMs);
  if (!lease) return { locked: true, value: null };
  try {
    const value = await fn(lease);
    return { locked: false, value };
  } finally {
    await coordinator.release(runId, lease.token);
  }
}
