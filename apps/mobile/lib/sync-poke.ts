// The phone's half of the chapter-head poke.
//
// Without this the only things that move a desk edit onto the phone are the
// author typing and the app coming back to the foreground. GET /api/sync/stream
// is an NDJSON channel that says "chapter X is at revision N" the moment a head
// moves; the watcher below compares that against the replica and asks for a
// pull only when the phone is genuinely behind. Revisions we already have, or
// are ahead of because our own push has not been echoed yet, are silence.
//
// No React here on purpose: the decision to pull is a pure comparison, and the
// reconnect loop is a plain closure, so both can be tested without a renderer.

import { ciciro } from "./api/resources";
import type { SyncStreamEvent } from "./api/types";

export type ChapterHead = {
  id: string;
  revision: number;
};

export type HeadWatcherOptions = {
  /** Called at most once per frame, however many chapters moved. */
  onBehind: () => void;
  /** The replica's revision for a chapter, or undefined if it has never seen it. */
  localRevision: (chapterId: string) => number | undefined;
};

/** Pull the heads out of a frame, dropping anything that is not well formed. */
function headsFrom(event: SyncStreamEvent): ChapterHead[] | null {
  if (event.type !== "heads") return null;
  const raw = (event as { chapters?: unknown }).chapters;
  if (!Array.isArray(raw)) return null;
  const heads: ChapterHead[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const head = item as { id?: unknown; revision?: unknown };
    if (typeof head.id !== "string" || !head.id) continue;
    if (typeof head.revision !== "number" || !Number.isFinite(head.revision)) continue;
    heads.push({ id: head.id, revision: head.revision });
  }
  return heads;
}

/**
 * The pure core: a frame handler that fires `onBehind` only when the server is
 * holding something this phone does not have. A chapter with no local revision
 * counts as behind — a chapter created on the desk is exactly the news worth
 * pulling for.
 */
export function createHeadWatcher(opts: HeadWatcherOptions): (event: SyncStreamEvent) => void {
  return (event) => {
    const heads = headsFrom(event);
    if (!heads || heads.length === 0) return;
    for (const head of heads) {
      const local = opts.localRevision(head.id);
      if (local === undefined || head.revision > local) {
        opts.onBehind();
        return;
      }
    }
  };
}

export type ChapterHeadStream = (
  projectId: string,
  onEvent: (event: SyncStreamEvent) => void,
  opts?: { signal?: AbortSignal }
) => Promise<void>;

export type ListenChapterHeadsOptions = HeadWatcherOptions & {
  /** Swapped in tests; production opens the real NDJSON channel. */
  open?: ChapterHeadStream;
  /** Swapped in tests so backoff does not cost real seconds. */
  backoffMs?: (attempt: number) => number;
};

export type ChapterHeadSubscription = (
  projectId: string,
  opts: ListenChapterHeadsOptions
) => () => void;

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

/**
 * Doubling backoff, capped. A clean end of stream (deploy, proxy timeout)
 * resets the count, so the ordinary case reconnects in a second and only a
 * genuinely unreachable server is backed away from.
 */
function defaultBackoff(attempt: number): number {
  return Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt);
}

const defaultOpen: ChapterHeadStream = (projectId, onEvent, opts) =>
  ciciro.sync.stream(projectId, onEvent, opts);

/**
 * Watch a project's chapter heads until the returned unsubscribe is called.
 * The connection is reopened after every drop: a poke channel that quietly
 * died would be worse than none, because the phone would stop expecting to be
 * told anything.
 */
export function listenChapterHeads(
  projectId: string,
  opts: ListenChapterHeadsOptions
): () => void {
  const open = opts.open ?? defaultOpen;
  const backoff = opts.backoffMs ?? defaultBackoff;
  const onEvent = createHeadWatcher(opts);

  let stopped = false;
  let attempt = 0;
  let inflight: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const connect = () => {
    if (stopped) return;
    const controller = new AbortController();
    inflight = controller;
    const settle = () => {
      inflight = null;
      if (stopped) return;
      timer = setTimeout(connect, backoff(attempt));
    };
    open(projectId, onEvent, { signal: controller.signal }).then(
      () => {
        attempt = 0;
        settle();
      },
      () => {
        attempt += 1;
        settle();
      }
    );
  };

  connect();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
    inflight?.abort();
    inflight = null;
  };
}
