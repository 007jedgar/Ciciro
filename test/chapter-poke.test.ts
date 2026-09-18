import { afterEach, describe, expect, it } from "vitest";
import {
  InProcessPokeHub,
  publishChapterHeads,
  setPokeDurableObjectNamespace,
  subscribeChapterHeads,
  type ChapterHeadPoke,
  type PokeDurableObjectNamespace,
} from "@/lib/chapter-poke";
import { ProjectPokeDO } from "@/worker/poke-do";

// The hub is a process singleton published on globalThis by the worker entry,
// the same way the run coordinator is. Tests that install one must put the
// process back as they found it.
const globalForPokes = globalThis as unknown as {
  __ciciroPokeNamespace__?: PokeDurableObjectNamespace;
  __ciciroPokeHub__?: unknown;
};

function clearPokeHub(): void {
  delete globalForPokes.__ciciroPokeNamespace__;
  delete globalForPokes.__ciciroPokeHub__;
}

afterEach(clearPokeHub);

describe("InProcessPokeHub", () => {
  it("delivers heads to a project's subscribers", async () => {
    const hub = new InProcessPokeHub();
    const seen: ChapterHeadPoke[][] = [];
    hub.subscribe("p1", (heads) => seen.push(heads));

    await hub.publish("p1", [{ chapterId: "c1", revision: 4 }]);

    expect(seen).toEqual([[{ chapterId: "c1", revision: 4 }]]);
  });

  it("does not leak a poke into another project", async () => {
    const hub = new InProcessPokeHub();
    const other: ChapterHeadPoke[][] = [];
    hub.subscribe("p2", (heads) => other.push(heads));

    await hub.publish("p1", [{ chapterId: "c1", revision: 1 }]);

    expect(other).toEqual([]);
  });

  it("stops delivering after unsubscribe", async () => {
    const hub = new InProcessPokeHub();
    const seen: ChapterHeadPoke[][] = [];
    const stop = hub.subscribe("p1", (heads) => seen.push(heads));

    await hub.publish("p1", [{ chapterId: "c1", revision: 1 }]);
    stop();
    await hub.publish("p1", [{ chapterId: "c1", revision: 2 }]);

    expect(seen).toHaveLength(1);
  });

  it("keeps fanning out when one subscriber throws", async () => {
    const hub = new InProcessPokeHub();
    const seen: ChapterHeadPoke[][] = [];
    hub.subscribe("p1", () => {
      throw new Error("stream already closed");
    });
    hub.subscribe("p1", (heads) => seen.push(heads));

    await hub.publish("p1", [{ chapterId: "c1", revision: 3 }]);

    expect(seen).toEqual([[{ chapterId: "c1", revision: 3 }]]);
  });

  it("is a no-op when nobody is watching", async () => {
    const hub = new InProcessPokeHub();
    await expect(hub.publish("p1", [{ chapterId: "c1", revision: 1 }])).resolves.toBeUndefined();
  });
});

describe("publishChapterHeads", () => {
  it("reaches an in-process subscriber through the default hub", async () => {
    const seen: ChapterHeadPoke[][] = [];
    const stop = subscribeChapterHeads("p1", (heads) => seen.push(heads));

    await publishChapterHeads("p1", [{ chapterId: "c1", revision: 7 }]);
    stop();

    expect(seen).toEqual([[{ chapterId: "c1", revision: 7 }]]);
  });

  it("never throws when a subscriber blows up", async () => {
    const stop = subscribeChapterHeads("p1", () => {
      throw new Error("boom");
    });

    await expect(
      publishChapterHeads("p1", [{ chapterId: "c1", revision: 1 }])
    ).resolves.toBeUndefined();
    stop();
  });

  it("never throws when the Durable Object is unreachable", async () => {
    setPokeDurableObjectNamespace({
      idFromName: (name: string) => name,
      get: () => ({
        fetch: async () => {
          throw new Error("no route to durable object");
        },
      }),
    });

    await expect(
      publishChapterHeads("p1", [{ chapterId: "c1", revision: 1 }])
    ).resolves.toBeUndefined();
  });

  it("skips the hub entirely for an empty poke", async () => {
    let called = 0;
    setPokeDurableObjectNamespace({
      idFromName: (name: string) => name,
      get: () => ({
        fetch: async () => {
          called += 1;
          return { status: 200 };
        },
      }),
    });

    await publishChapterHeads("p1", []);
    await publishChapterHeads("", [{ chapterId: "c1", revision: 1 }]);

    expect(called).toBe(0);
  });

  it("forwards the poke to the Durable Object when one is bound", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    setPokeDurableObjectNamespace({
      idFromName: (name: string) => name,
      get: () => ({
        fetch: async (input: string, init?: RequestInit) => {
          calls.push({ url: input, body: JSON.parse(String(init?.body ?? "null")) });
          return { status: 200 };
        },
      }),
    });

    await publishChapterHeads("p1", [{ chapterId: "c1", revision: 9 }]);

    expect(calls).toEqual([
      {
        url: "https://poke/publish",
        body: { heads: [{ chapterId: "c1", revision: 9 }] },
      },
    ]);
  });
});

// A DurableObjectState backed by a plain list of sockets, enough to exercise
// the broadcast. Hibernation is why getWebSockets() is the source of truth:
// the instance that publishes may not be the one that accepted the sockets.
function makeState(sockets: Array<{ sent: string[]; closed: boolean }>) {
  return {
    acceptWebSocket(ws: { sent: string[]; closed: boolean }) {
      sockets.push(ws);
    },
    getWebSockets() {
      return sockets.map((ws) => ({
        send: (message: string) => ws.sent.push(message),
        close: () => {
          ws.closed = true;
        },
      }));
    },
  };
}

describe("ProjectPokeDO", () => {
  it("broadcasts published heads to every attached socket", async () => {
    const sockets = [
      { sent: [] as string[], closed: false },
      { sent: [] as string[], closed: false },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dobj = new ProjectPokeDO(makeState(sockets) as any);

    const res = await dobj.fetch(
      new Request("https://poke/publish", {
        method: "POST",
        body: JSON.stringify({ heads: [{ chapterId: "c1", revision: 2 }] }),
      })
    );

    expect(await res.json()).toEqual({ delivered: 2 });
    for (const socket of sockets) {
      expect(socket.sent).toEqual([
        JSON.stringify({ heads: [{ chapterId: "c1", revision: 2 }] }),
      ]);
    }
  });

  it("drops malformed heads rather than broadcasting them", async () => {
    const sockets = [{ sent: [] as string[], closed: false }];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dobj = new ProjectPokeDO(makeState(sockets) as any);

    const res = await dobj.fetch(
      new Request("https://poke/publish", {
        method: "POST",
        body: JSON.stringify({ heads: [{ chapterId: "", revision: 1 }, { chapterId: "c1" }] }),
      })
    );

    expect(await res.json()).toEqual({ delivered: 0 });
    expect(sockets[0].sent).toEqual([]);
  });

  // The 101 handshake itself cannot be built under Node (Response rejects that
  // status), so only the guard in front of it is exercised here.
  it("refuses a subscribe that is not a websocket upgrade", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dobj = new ProjectPokeDO(makeState([]) as any);
    const res = await dobj.fetch(new Request("https://poke/subscribe"));
    expect(res.status).toBe(426);
  });

  it("404s an unknown path", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dobj = new ProjectPokeDO(makeState([]) as any);
    const res = await dobj.fetch(new Request("https://poke/nope"));
    expect(res.status).toBe(404);
  });
});
