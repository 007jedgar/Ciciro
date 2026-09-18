// Chapter head pokes: "chapter X is at revision N", pushed the moment a head
// moves so a connected client pulls once instead of waiting for the author to
// type or foreground the app.
//
// A poke carries no prose and no ops. It is the smallest thing that can stand
// in for polling: the client compares the revision against its replica and asks
// for the real bytes only when it is genuinely behind.
//
// - Locally (Node) the InProcessPokeHub fans a publish out to subscribers
//   inside one process, which is all a single Node server needs.
// - On Cloudflare the writing request and the streaming request are different
//   isolates, so the fan-out needs one meeting point per project: a Durable
//   Object (see src/worker/poke-do.ts). The DurableObjectsPokeHub publishes to
//   it over fetch and subscribes to it over a WebSocket.
//
// getPokeHub() picks the DO-backed implementation when a binding has been
// published on globalThis by the worker entry, and falls back to in-process
// otherwise, so the Node build and tests keep working unchanged.

export type ChapterHeadPoke = {
  chapterId: string;
  revision: number;
};

export type ChapterHeadListener = (heads: ChapterHeadPoke[]) => void;

export interface PokeHub {
  /** Announce moved heads to everyone watching this project. */
  publish(projectId: string, heads: ChapterHeadPoke[]): Promise<void>;
  /** Watch a project's heads. Returns the unsubscribe. */
  subscribe(projectId: string, onHeads: ChapterHeadListener): () => void;
}

/** Keep only well-formed heads: this shape crosses a network boundary. */
export function parseChapterHeads(value: unknown): ChapterHeadPoke[] {
  if (!Array.isArray(value)) return [];
  const heads: ChapterHeadPoke[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const head = item as { chapterId?: unknown; revision?: unknown };
    if (typeof head.chapterId !== "string" || !head.chapterId) continue;
    if (!Number.isInteger(head.revision)) continue;
    heads.push({ chapterId: head.chapterId, revision: head.revision as number });
  }
  return heads;
}

/**
 * Process-local hub. Subscribers are held per project so a publish touches
 * only the rooms that asked for it.
 */
export class InProcessPokeHub implements PokeHub {
  private rooms = new Map<string, Set<ChapterHeadListener>>();

  async publish(projectId: string, heads: ChapterHeadPoke[]): Promise<void> {
    const room = this.rooms.get(projectId);
    if (!room || heads.length === 0) return;
    // A listener that throws is its own problem. The others still deserve the
    // poke, and the write that produced it has already committed.
    for (const listener of [...room]) {
      try {
        listener(heads);
      } catch {
        /* a dead stream cannot hold up the rest of the room */
      }
    }
  }

  subscribe(projectId: string, onHeads: ChapterHeadListener): () => void {
    const room = this.rooms.get(projectId) ?? new Set<ChapterHeadListener>();
    room.add(onHeads);
    this.rooms.set(projectId, room);
    return () => {
      const current = this.rooms.get(projectId);
      if (!current) return;
      current.delete(onHeads);
      if (current.size === 0) this.rooms.delete(projectId);
    };
  }
}

// Minimal shapes of a Durable Object namespace binding and of the socket a 101
// response hands back. Declared locally so this module typechecks in a plain
// Node build without @cloudflare/workers-types.
export interface PokeWebSocket {
  accept(): void;
  send(message: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "message", handler: (event: { data: unknown }) => void): void;
}

export interface PokeDurableObjectNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): {
    fetch(
      input: string,
      init?: RequestInit
    ): Promise<{ status: number; webSocket?: PokeWebSocket | null }>;
  };
}

/**
 * Cloudflare-backed hub. Each project maps to one Durable Object instance, so
 * a publish from any isolate reaches every stream the fleet is holding open.
 */
export class DurableObjectsPokeHub implements PokeHub {
  constructor(private ns: PokeDurableObjectNamespace) {}

  private stub(projectId: string) {
    return this.ns.get(this.ns.idFromName(projectId));
  }

  async publish(projectId: string, heads: ChapterHeadPoke[]): Promise<void> {
    if (heads.length === 0) return;
    await this.stub(projectId).fetch("https://poke/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ heads }),
    });
  }

  subscribe(projectId: string, onHeads: ChapterHeadListener): () => void {
    // The handshake is async but subscribe is not: the caller gets an
    // unsubscribe it can use immediately, and a socket that arrives after the
    // caller has already stopped is closed on arrival rather than leaked.
    let socket: PokeWebSocket | null = null;
    let stopped = false;

    void this.stub(projectId)
      .fetch("https://poke/subscribe", { headers: { upgrade: "websocket" } })
      .then((res) => {
        const ws = res.webSocket;
        if (!ws) return;
        if (stopped) {
          ws.close();
          return;
        }
        socket = ws;
        ws.accept();
        ws.addEventListener("message", (event) => {
          const message = typeof event.data === "string" ? event.data : "";
          if (!message) return;
          let parsed: unknown;
          try {
            parsed = JSON.parse(message) as unknown;
          } catch {
            return;
          }
          const heads = parseChapterHeads((parsed as { heads?: unknown } | null)?.heads);
          if (heads.length > 0) onHeads(heads);
        });
      })
      .catch(() => {
        /* no poke channel; the client still pulls on its own schedule */
      });

    return () => {
      stopped = true;
      try {
        socket?.close();
      } catch {
        /* already gone */
      }
    };
  }
}

// The worker entry publishes its DO namespace here so server code can reach it
// without importing Cloudflare-only modules at build time.
const globalForPokes = globalThis as unknown as {
  __ciciroPokeNamespace__?: PokeDurableObjectNamespace;
  __ciciroPokeHub__?: PokeHub;
};

/** Register the Durable Object namespace (called from the worker entry). */
export function setPokeDurableObjectNamespace(ns: PokeDurableObjectNamespace): void {
  globalForPokes.__ciciroPokeNamespace__ = ns;
  globalForPokes.__ciciroPokeHub__ = new DurableObjectsPokeHub(ns);
}

/** Resolve the active hub (DO-backed on Cloudflare, else in-process). */
export function getPokeHub(): PokeHub {
  if (globalForPokes.__ciciroPokeHub__) {
    return globalForPokes.__ciciroPokeHub__;
  }
  if (globalForPokes.__ciciroPokeNamespace__) {
    globalForPokes.__ciciroPokeHub__ = new DurableObjectsPokeHub(
      globalForPokes.__ciciroPokeNamespace__
    );
    return globalForPokes.__ciciroPokeHub__;
  }
  const singleton = new InProcessPokeHub();
  globalForPokes.__ciciroPokeHub__ = singleton;
  return singleton;
}

/**
 * How long a publish may hold up the caller. The Durable Object lives in the
 * same region as the write, so a healthy poke is a couple of milliseconds; the
 * cap is here for the unhealthy one. An author saving a paragraph must never
 * wait on the notification that the paragraph was saved.
 */
const PUBLISH_TIMEOUT_MS = 250;

/**
 * Announce moved heads. Best-effort on purpose: the write that produced these
 * revisions has already committed, and a lost poke costs only the latency the
 * phone had before pokes existed. Nothing here may fail or delay a write.
 */
export async function publishChapterHeads(
  projectId: string,
  heads: ChapterHeadPoke[]
): Promise<void> {
  if (!projectId || heads.length === 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      getPokeHub().publish(projectId, heads),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, PUBLISH_TIMEOUT_MS);
      }),
    ]);
  } catch {
    /* a poke is a latency optimization, never a correctness one */
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Watch a project's chapter heads. Returns the unsubscribe. */
export function subscribeChapterHeads(
  projectId: string,
  onHeads: ChapterHeadListener
): () => void {
  return getPokeHub().subscribe(projectId, onHeads);
}
