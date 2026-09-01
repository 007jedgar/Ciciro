// EditorRunDO — one Durable Object instance per editor run.
//
// The Durable Object runtime executes one request at a time per instance, so
// acquire/renew/release are naturally serialized: this is the authoritative
// single-writer gate for a run's slices across the whole Cloudflare fleet. The
// lease is persisted in DO storage and an alarm clears it if a slice dies while
// holding the lock, so a crashed worker cannot wedge the run.
//
// This file is compiled by the Cloudflare/wrangler toolchain, not by Next. The
// minimal ambient interfaces below let it typecheck in a plain Node/tsc build
// without pulling in @cloudflare/workers-types; the real runtime types are
// structurally compatible.

interface DurableObjectStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  setAlarm(scheduledTime: number): Promise<void>;
}

interface DurableObjectState {
  storage: DurableObjectStorage;
  blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T>;
}

type Lease = { token: string; expiresAt: number };

const LEASE_KEY = "lease";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export class EditorRunDO {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  private async liveLease(now: number): Promise<Lease | null> {
    const lease = await this.state.storage.get<Lease>(LEASE_KEY);
    if (!lease) return null;
    if (lease.expiresAt <= now) {
      await this.state.storage.delete(LEASE_KEY);
      return null;
    }
    return lease;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/+/, "");
    const body = (await request.json().catch(() => ({}))) as {
      token?: string;
      ttlMs?: number;
    };
    const now = Date.now();

    if (path === "acquire") {
      return this.state.blockConcurrencyWhile(async () => {
        if (await this.liveLease(now)) return json({ error: "locked" }, 409);
        const ttl = clampTtl(body.ttlMs);
        const lease: Lease = { token: crypto.randomUUID(), expiresAt: now + ttl };
        await this.state.storage.put(LEASE_KEY, lease);
        await this.state.storage.setAlarm(lease.expiresAt);
        return json(lease);
      });
    }

    if (path === "renew") {
      return this.state.blockConcurrencyWhile(async () => {
        const lease = await this.liveLease(now);
        if (!lease || lease.token !== body.token) return json({ renewed: false });
        lease.expiresAt = now + clampTtl(body.ttlMs);
        await this.state.storage.put(LEASE_KEY, lease);
        await this.state.storage.setAlarm(lease.expiresAt);
        return json({ renewed: true });
      });
    }

    if (path === "release") {
      return this.state.blockConcurrencyWhile(async () => {
        const lease = await this.state.storage.get<Lease>(LEASE_KEY);
        if (lease && lease.token === body.token) {
          await this.state.storage.delete(LEASE_KEY);
        }
        return json({ released: true });
      });
    }

    if (path === "status") {
      const lease = await this.liveLease(now);
      return json({ lease: lease ?? null });
    }

    return json({ error: "not found" }, 404);
  }

  // Fired when a lease TTL elapses without release; clears the dead lock.
  async alarm(): Promise<void> {
    const lease = await this.state.storage.get<Lease>(LEASE_KEY);
    if (lease && lease.expiresAt <= Date.now()) {
      await this.state.storage.delete(LEASE_KEY);
    }
  }
}

const MAX_TTL_MS = 15 * 60_000;
const MIN_TTL_MS = 1_000;

function clampTtl(raw: unknown): number {
  const ttl = typeof raw === "number" && Number.isFinite(raw) ? raw : 5 * 60_000;
  return Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, ttl));
}
