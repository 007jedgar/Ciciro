// One chapter save through the optimistic store: PATCH on the confirmed
// revision, retry a network failure once, and on a 409 either adopt the
// server's copy or, when the writer has typed past the save, send their newer
// words on the server's revision.

import type { Chapter } from "@/lib/types";
import {
  handleNetworkFailure,
  saveOutcome,
  type LocalChapterFields,
  type OptimisticChapterStore,
  type SaveAttempt,
  type SaveOutcome,
  type SavePayload,
} from "@/lib/optimistic-chapter";

/** What the save indicator should say for a moment after a save. */
export type SaveHint = "error" | "restored";

export type ChapterSaveDeps = {
  store: OptimisticChapterStore;
  send: (id: string, body: SavePayload & { expectedRevision: number }) => Promise<Response>;
  getLocalFields: (id: string) => LocalChapterFields | null;
  updateChapterLocal: (id: string, patch: Partial<Chapter>) => void;
  showHint: (hint: SaveHint) => void;
};

export type ChapterSaveResult = {
  outcome: SaveOutcome;
  /** False when the writer's copy still holds text the server does not have. */
  settled: boolean;
};

export async function saveChapter(
  deps: ChapterSaveDeps,
  id: string,
  fields: SavePayload
): Promise<ChapterSaveResult> {
  const { store, getLocalFields, updateChapterLocal, showHint } = deps;

  const attemptSave = async (payload: SavePayload): Promise<SaveAttempt> => {
    const expectedRevision = store.getExpectedRevision(id);
    if (expectedRevision == null) return "fail";
    try {
      const res = await deps.send(id, { ...payload, expectedRevision });
      if (res.status === 409) {
        const body = (await res.json()) as { chapter?: Chapter };
        const serverChapter = body.chapter;
        const local = getLocalFields(id);
        if (!serverChapter || !local) return "fail";

        const result = store.apply409(id, serverChapter, local, payload);
        updateChapterLocal(id, result.localPatch);

        if (result.retry) {
          Object.assign(payload, result.retry);
          return "409-retry";
        }
        showHint("restored");
        return "409-restored";
      }
      if (!res.ok) return "fail";
      const chapter = (await res.json()) as Chapter;
      const { localPatch } = store.applySuccess(id, chapter);
      updateChapterLocal(id, localPatch);
      return "ok";
    } catch {
      return "fail";
    }
  };

  const payload = { ...fields };
  const attempts: SaveAttempt[] = [await attemptSave(payload)];
  if (attempts[0] === "fail") {
    attempts.push(await attemptSave(payload));
  } else if (attempts[0] === "409-retry") {
    attempts.push(await attemptSave(payload));
    if (attempts[1] === "409-retry") attempts.push(await attemptSave(payload));
  }
  const last = attempts[attempts.length - 1];
  let settled = last !== "fail" && last !== "409-retry";
  if (last === "fail") {
    const confirmed = store.get(id);
    const local = getLocalFields(id);
    if (confirmed && local) {
      const failure = handleNetworkFailure(confirmed, local, payload);
      if (failure.localPatch) {
        updateChapterLocal(id, failure.localPatch);
        settled = true;
      }
      showHint(failure.uiHint);
    } else {
      showHint("error");
    }
  } else if (last === "409-retry") {
    showHint("error");
  }
  return { outcome: saveOutcome(attempts), settled };
}

/**
 * Put earlier text back into a chapter, on the revision this device last
 * confirmed. The writer's copy changes only once the server has answered: to
 * the restored text when it took it, or to the server's own newer copy on a
 * 409, which is never written over. A network failure leaves it as it was.
 */
export async function restoreChapter(
  deps: Pick<ChapterSaveDeps, "store" | "send" | "updateChapterLocal">,
  id: string,
  content: string
): Promise<SaveOutcome> {
  const { store, updateChapterLocal } = deps;
  const attempt = async (): Promise<SaveAttempt> => {
    const expectedRevision = store.getExpectedRevision(id);
    if (expectedRevision == null) return "fail";
    try {
      const res = await deps.send(id, { content, expectedRevision });
      if (res.status === 409) {
        const body = (await res.json()) as { chapter?: Chapter };
        if (!body.chapter) return "fail";
        store.seed(body.chapter);
        updateChapterLocal(id, {
          content: body.chapter.content,
          wordCount: body.chapter.wordCount,
          revision: body.chapter.revision,
        });
        return "409-restored";
      }
      if (!res.ok) return "fail";
      const chapter = (await res.json()) as Chapter;
      const { localPatch } = store.applySuccess(id, chapter);
      updateChapterLocal(id, { ...localPatch, content: chapter.content });
      return "ok";
    } catch {
      return "fail";
    }
  };
  let last = await attempt();
  if (last === "fail") last = await attempt();
  return saveOutcome([last]);
}
