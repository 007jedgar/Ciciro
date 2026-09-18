// ProjectPokeDO — one Durable Object instance per project.
//
// Every isolate that serves /api/sync/stream is its own process, so "a chapter
// head moved" has to pass through one meeting point before it can reach the
// phones watching that project. This is it: a stream attaches a WebSocket via
// /subscribe, the isolate that accepted the write POSTs /publish, and the DO
// broadcasts the heads to every attached socket.
//
// Sockets are accepted through the hibernation API, so a project with watchers
// but no traffic costs nothing while it is quiet: the instance can be evicted
// and getWebSockets() hands the connections back when the next publish wakes
// it. Nothing is persisted — a poke is disposable, and a client that missed one
// gets the current heads on its next connect.
//
// This file is compiled by the Cloudflare/wrangler toolchain, not by Next. The
// minimal ambient declarations below let it typecheck in a plain Node/tsc build
// without pulling in @cloudflare/workers-types; the real runtime types are
// structurally compatible.

interface PokeWebSocket {
  send(message: string): void;
  close(code?: number, reason?: string): void;
}

interface DurableObjectState {
  acceptWebSocket(ws: PokeWebSocket): void;
  getWebSockets(): PokeWebSocket[];
}

declare const WebSocketPair: {
  new (): { 0: PokeWebSocket; 1: PokeWebSocket };
};

type ChapterHead = { chapterId: string; revision: number };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Only the Workers runtime's ResponseInit carries the client half of a socket
// pair, hence the cast; a plain DOM ResponseInit has no such field.
function upgraded(client: PokeWebSocket): Response {
  return new Response(null, { status: 101, webSocket: client } as ResponseInit);
}

function parseHeads(value: unknown): ChapterHead[] {
  if (!Array.isArray(value)) return [];
  const heads: ChapterHead[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const head = item as { chapterId?: unknown; revision?: unknown };
    if (typeof head.chapterId !== "string" || !head.chapterId) continue;
    if (!Number.isInteger(head.revision)) continue;
    heads.push({ chapterId: head.chapterId, revision: head.revision as number });
  }
  return heads;
}

export class ProjectPokeDO {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname.replace(/^\/+/, "");

    if (path === "subscribe") {
      if (request.headers.get("upgrade") !== "websocket") {
        return json({ error: "expected websocket" }, 426);
      }
      const pair = new WebSocketPair();
      this.state.acceptWebSocket(pair[1]);
      return upgraded(pair[0]);
    }

    if (path === "publish") {
      const body = (await request.json().catch(() => ({}))) as { heads?: unknown };
      const heads = parseHeads(body.heads);
      if (heads.length === 0) return json({ delivered: 0 });
      const frame = JSON.stringify({ heads });
      let delivered = 0;
      for (const ws of this.state.getWebSockets()) {
        try {
          ws.send(frame);
          delivered += 1;
        } catch {
          // A socket the runtime has not noticed is gone yet. Drop it rather
          // than let one dead phone fail the publish for the live ones.
          try {
            ws.close(1011, "send failed");
          } catch {
            /* already closed */
          }
        }
      }
      return json({ delivered });
    }

    return json({ error: "not found" }, 404);
  }

  // Subscribers only listen, so anything they say is ignored. The handler still
  // has to exist for hibernation to deliver into.
  async webSocketMessage(): Promise<void> {}

  async webSocketClose(ws: PokeWebSocket): Promise<void> {
    try {
      ws.close();
    } catch {
      /* the peer already hung up */
    }
  }

  async webSocketError(ws: PokeWebSocket): Promise<void> {
    try {
      ws.close(1011, "socket error");
    } catch {
      /* the peer already hung up */
    }
  }
}
