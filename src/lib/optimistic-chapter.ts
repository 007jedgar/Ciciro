import type { Chapter } from "@/lib/types";

/** Fields tracked for optimistic save / rollback. */
export type ChapterSaveFields = Pick<Chapter, "content" | "title" | "status">;

export type SavePayload = Partial<ChapterSaveFields>;

/** Last server-ACKed snapshot used for rollback. */
export type ConfirmedSnapshot = {
  content: string;
  title: string;
  status: string;
  revision: number;
  wordCount: number;
};

export type LocalChapterFields = ChapterSaveFields;

export function snapshotFromChapter(chapter: Chapter): ConfirmedSnapshot {
  return {
    content: chapter.content,
    title: chapter.title,
    status: chapter.status,
    revision: chapter.revision,
    wordCount: chapter.wordCount,
  };
}

/** True when every in-flight field still matches local (user has not typed past the save). */
export function localMatchesInFlight(
  local: LocalChapterFields,
  inFlight: SavePayload
): boolean {
  for (const key of Object.keys(inFlight) as (keyof SavePayload)[]) {
    if (local[key] !== inFlight[key]) return false;
  }
  return true;
}

/** Roll back only the fields that were in the in-flight payload to confirmed values. */
export function rollbackInFlightFields(
  confirmed: ConfirmedSnapshot,
  inFlight: SavePayload
): Partial<Chapter> {
  const patch: Partial<Chapter> = {};
  for (const key of Object.keys(inFlight) as (keyof SavePayload)[]) {
    patch[key] = confirmed[key];
  }
  if ("content" in inFlight) {
    patch.wordCount = confirmed.wordCount;
  }
  return patch;
}

/** Build a retry payload: current local values for fields that were in-flight. */
export function buildRetryPayload(
  local: LocalChapterFields,
  inFlight: SavePayload
): SavePayload {
  const retry: SavePayload = {};
  for (const key of Object.keys(inFlight) as (keyof SavePayload)[]) {
    retry[key] = local[key];
  }
  return retry;
}

export type SaveSuccessResult = {
  confirmed: ConfirmedSnapshot;
  localPatch: Partial<Chapter>;
};

/** Advance confirmed snapshot after a successful PATCH. */
export function handleSaveSuccess(
  _confirmed: ConfirmedSnapshot,
  serverChapter: Chapter
): SaveSuccessResult {
  const next = snapshotFromChapter(serverChapter);
  return {
    confirmed: next,
    localPatch: {
      revision: serverChapter.revision,
      wordCount: serverChapter.wordCount,
    },
  };
}

export type ConflictResult = {
  confirmed: ConfirmedSnapshot;
  localPatch: Partial<Chapter>;
  retry?: SavePayload;
  /** Brief UI hint — restored server copy or retrying newer local edits. */
  uiHint: "restored" | "retrying";
};

/** Resolve a 409 revision conflict against server chapter + local editor state. */
export function handle409Conflict(
  _confirmed: ConfirmedSnapshot,
  serverChapter: Chapter,
  local: LocalChapterFields,
  inFlight: SavePayload
): ConflictResult {
  const serverSnapshot = snapshotFromChapter(serverChapter);

  if (localMatchesInFlight(local, inFlight)) {
    return {
      confirmed: serverSnapshot,
      localPatch: {
        content: serverSnapshot.content,
        title: serverSnapshot.title,
        status: serverSnapshot.status,
        revision: serverSnapshot.revision,
        wordCount: serverSnapshot.wordCount,
      },
      uiHint: "restored",
    };
  }

  return {
    confirmed: serverSnapshot,
    localPatch: { revision: serverSnapshot.revision },
    retry: buildRetryPayload(local, inFlight),
    uiHint: "retrying",
  };
}

export type NetworkFailureResult = {
  localPatch?: Partial<Chapter>;
  uiHint: "restored" | "error";
};

/** After retries exhausted: rollback in-flight fields if local still matches what we sent. */
export function handleNetworkFailure(
  confirmed: ConfirmedSnapshot,
  local: LocalChapterFields,
  inFlight: SavePayload
): NetworkFailureResult {
  if (localMatchesInFlight(local, inFlight)) {
    return {
      localPatch: rollbackInFlightFields(confirmed, inFlight),
      uiHint: "restored",
    };
  }
  return { uiHint: "error" };
}

/** Per-chapter confirmed snapshots for optimistic saves. */
export class OptimisticChapterStore {
  private confirmed = new Map<string, ConfirmedSnapshot>();

  init(chapters: Chapter[]) {
    this.confirmed.clear();
    for (const ch of chapters) {
      this.confirmed.set(ch.id, snapshotFromChapter(ch));
    }
  }

  seed(chapter: Chapter) {
    this.confirmed.set(chapter.id, snapshotFromChapter(chapter));
  }

  get(id: string): ConfirmedSnapshot | undefined {
    return this.confirmed.get(id);
  }

  getExpectedRevision(id: string): number | undefined {
    return this.confirmed.get(id)?.revision;
  }

  setConfirmed(id: string, snapshot: ConfirmedSnapshot) {
    this.confirmed.set(id, snapshot);
  }

  applySuccess(id: string, serverChapter: Chapter): SaveSuccessResult {
    const current = this.confirmed.get(id);
    if (!current) {
      const next = snapshotFromChapter(serverChapter);
      this.confirmed.set(id, next);
      return { confirmed: next, localPatch: { revision: serverChapter.revision, wordCount: serverChapter.wordCount } };
    }
    const result = handleSaveSuccess(current, serverChapter);
    this.confirmed.set(id, result.confirmed);
    return result;
  }

  apply409(
    id: string,
    serverChapter: Chapter,
    local: LocalChapterFields,
    inFlight: SavePayload
  ): ConflictResult {
    const current = this.confirmed.get(id) ?? snapshotFromChapter(serverChapter);
    const result = handle409Conflict(current, serverChapter, local, inFlight);
    this.confirmed.set(id, result.confirmed);
    return result;
  }

  /** Compare local chapter fields to last confirmed snapshot. */
  hasLocalEdits(id: string, local: LocalChapterFields): boolean {
    const confirmed = this.confirmed.get(id);
    if (!confirmed) return false;
    return (
      local.content !== confirmed.content ||
      local.title !== confirmed.title ||
      local.status !== confirmed.status
    );
  }
}
