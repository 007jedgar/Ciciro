import { describe, expect, it } from "vitest";
import {
  DurableObjectsCoordinator,
  InProcessCoordinator,
  withRunLock,
  type RunDurableObjectNamespace,
} from "@/lib/durable/coordinator";
import { EditorRunDO } from "@/worker/run-do";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("InProcessCoordinator", () => {
  it("grants one holder at a time", async () => {
    const c = new InProcessCoordinator();
    const first = await c.acquire("run-1", 60_000);
    expect(first).not.toBeNull();
    const second = await c.acquire("run-1", 60_000);
    expect(second).toBeNull();
  });

  it("lets a different run lock independently", async () => {
    const c = new InProcessCoordinator();
    expect(await c.acquire("run-a", 60_000)).not.toBeNull();
    expect(await c.acquire("run-b", 60_000)).not.toBeNull();
  });

  it("releases so the lock can be re-acquired", async () => {
    const c = new InProcessCoordinator();
    const lease = await c.acquire("run-1", 60_000);
    expect(lease).not.toBeNull();
    await c.release("run-1", lease!.token);
    expect(await c.acquire("run-1", 60_000)).not.toBeNull();
  });

  it("ignores a release with a stale token", async () => {
    const c = new InProcessCoordinator();
    await c.acquire("run-1", 60_000);
    await c.release("run-1", "not-the-token");
    expect(await c.acquire("run-1", 60_000)).toBeNull();
  });

  it("renews only for the owning token", async () => {
    const c = new InProcessCoordinator();
    const lease = await c.acquire("run-1", 60_000);
    expect(await c.renew("run-1", lease!.token, 60_000)).toBe(true);
    expect(await c.renew("run-1", "other", 60_000)).toBe(false);
  });

  it("expires a lease after its TTL", async () => {
    const c = new InProcessCoordinator();
    const lease = await c.acquire("run-1", 40);
    expect(lease).not.toBeNull();
    expect(await c.acquire("run-1", 40)).toBeNull();
    await sleep(60);
    expect(await c.acquire("run-1", 40)).not.toBeNull();
  });
});

describe("withRunLock", () => {
  it("runs fn while holding the lock and releases after", async () => {
    const c = new InProcessCoordinator();
    const result = await withRunLock("run-1", 60_000, async () => "did-work", c);
    expect(result).toEqual({ locked: false, value: "did-work" });
    // Released: a subsequent lock succeeds.
    const again = await withRunLock("run-1", 60_000, async () => "again", c);
    expect(again.locked).toBe(false);
  });

  it("returns locked without running fn when another holder is active", async () => {
    const c = new InProcessCoordinator();
    await c.acquire("run-1", 60_000);
    let ran = false;
    const result = await withRunLock(
      "run-1",
      60_000,
      async () => {
        ran = true;
        return "should-not-run";
      },
      c
    );
    expect(ran).toBe(false);
    expect(result).toEqual({ locked: true, value: null });
  });

  it("releases the lock even when fn throws", async () => {
    const c = new InProcessCoordinator();
    await expect(
      withRunLock("run-1", 60_000, async () => {
        throw new Error("boom");
      }, c)
    ).rejects.toThrow("boom");
    // Lock is free again.
    expect(await c.acquire("run-1", 60_000)).not.toBeNull();
  });
});

// A DurableObjectState backed by an in-memory map, enough to exercise EditorRunDO.
function makeState() {
  const map = new Map<string, unknown>();
  return {
    storage: {
      async get<T>(k: string) {
        return map.get(k) as T | undefined;
      },
      async put<T>(k: string, v: T) {
        map.set(k, v);
      },
      async delete(k: string) {
        return map.delete(k);
      },
      async setAlarm() {},
    },
    async blockConcurrencyWhile<T>(fn: () => Promise<T>) {
      return fn();
    },
  };
}

// A namespace whose stubs route fetch() to a per-id EditorRunDO instance.
function makeNamespace(): RunDurableObjectNamespace {
  const instances = new Map<string, EditorRunDO>();
  return {
    idFromName(name: string) {
      return name;
    },
    get(id: unknown) {
      const key = String(id);
      if (!instances.has(key)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        instances.set(key, new EditorRunDO(makeState() as any));
      }
      const dobj = instances.get(key)!;
      return {
        fetch(input: string, init?: RequestInit) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return dobj.fetch(new Request(input, init) as any);
        },
      };
    },
  };
}

describe("DurableObjectsCoordinator + EditorRunDO", () => {
  it("serializes acquire/release through the Durable Object", async () => {
    const c = new DurableObjectsCoordinator(makeNamespace());
    const lease = await c.acquire("run-1", 60_000);
    expect(lease?.token).toBeTruthy();
    expect(await c.acquire("run-1", 60_000)).toBeNull();

    await c.release("run-1", lease!.token);
    expect(await c.acquire("run-1", 60_000)).not.toBeNull();
  });

  it("renews only for the owning token", async () => {
    const c = new DurableObjectsCoordinator(makeNamespace());
    const lease = await c.acquire("run-2", 60_000);
    expect(await c.renew("run-2", lease!.token, 60_000)).toBe(true);
    expect(await c.renew("run-2", "bogus", 60_000)).toBe(false);
  });

  it("expires the DO lease after its TTL", async () => {
    // EditorRunDO clamps TTL to a 1s floor, so the wait must clear that floor.
    const c = new DurableObjectsCoordinator(makeNamespace());
    const lease = await c.acquire("run-3", 1);
    expect(lease).not.toBeNull();
    expect(await c.acquire("run-3", 1)).toBeNull();
    await sleep(1200);
    expect(await c.acquire("run-3", 1)).not.toBeNull();
  });
});
