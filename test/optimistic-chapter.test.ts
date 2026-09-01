import { describe, expect, it } from "vitest";
import type { Chapter } from "@/lib/types";
import {
  OptimisticChapterStore,
  buildRetryPayload,
  handle409Conflict,
  handleNetworkFailure,
  handleSaveSuccess,
  localMatchesInFlight,
  rollbackInFlightFields,
  snapshotFromChapter,
} from "@/lib/optimistic-chapter";

function chapter(overrides: Partial<Chapter> = {}): Chapter {
  return {
    id: "ch1",
    projectId: "p1",
    title: "Chapter One",
    order: 0,
    content: "<p>Hello</p>",
    summary: "",
    status: "draft",
    wordCount: 1,
    revision: 3,
    ...overrides,
  };
}

describe("optimistic chapter save", () => {
  it("ack advances confirmed revision", () => {
    const confirmed = snapshotFromChapter(chapter({ revision: 3, wordCount: 1 }));
    const server = chapter({ revision: 4, wordCount: 2, content: "<p>Hello world</p>" });
    const result = handleSaveSuccess(confirmed, server);

    expect(result.confirmed.revision).toBe(4);
    expect(result.confirmed.content).toBe("<p>Hello world</p>");
    expect(result.localPatch).toEqual({ revision: 4, wordCount: 2 });

    const store = new OptimisticChapterStore();
    store.init([chapter({ revision: 3 })]);
    const applied = store.applySuccess("ch1", server);
    expect(store.getExpectedRevision("ch1")).toBe(4);
    expect(applied.localPatch.revision).toBe(4);
  });

  it("409 with no further local edits restores server chapter", () => {
    const confirmed = snapshotFromChapter(chapter({ revision: 3 }));
    const server = chapter({
      revision: 5,
      content: "<p>Server wins</p>",
      title: "Server title",
      wordCount: 2,
    });
    const local = { content: "<p>Stale</p>", title: "Chapter One", status: "draft" };
    const inFlight = { content: "<p>Stale</p>" };

    expect(localMatchesInFlight(local, inFlight)).toBe(true);

    const result = handle409Conflict(confirmed, server, local, inFlight);
    expect(result.uiHint).toBe("restored");
    expect(result.retry).toBeUndefined();
    expect(result.localPatch).toEqual({
      content: "<p>Server wins</p>",
      title: "Server title",
      status: "draft",
      revision: 5,
      wordCount: 2,
    });
    expect(result.confirmed.revision).toBe(5);
  });

  it("409 with further local edits keeps later text and retries on new revision", () => {
    const confirmed = snapshotFromChapter(chapter({ revision: 3 }));
    const server = chapter({ revision: 6, content: "<p>Server</p>", wordCount: 1 });
    const local = {
      content: "<p>Stale plus more typing</p>",
      title: "Chapter One",
      status: "draft",
    };
    const inFlight = { content: "<p>Stale</p>" };

    expect(localMatchesInFlight(local, inFlight)).toBe(false);

    const result = handle409Conflict(confirmed, server, local, inFlight);
    expect(result.uiHint).toBe("retrying");
    expect(result.localPatch).toEqual({ revision: 6 });
    expect(result.retry).toEqual({ content: "<p>Stale plus more typing</p>" });
    expect(result.confirmed.revision).toBe(6);

    expect(buildRetryPayload(local, inFlight)).toEqual({
      content: "<p>Stale plus more typing</p>",
    });
  });

  it("in-flight mismatch vs confirmed rolls back only in-flight fields on network failure", () => {
    const confirmed = snapshotFromChapter(
      chapter({ content: "<p>Confirmed</p>", title: "Confirmed title", revision: 2 })
    );
    const inFlight = { content: "<p>Failed save</p>" };
    const localStillInFlight = {
      content: "<p>Failed save</p>",
      title: "Confirmed title",
      status: "draft",
    };

    expect(
      rollbackInFlightFields(confirmed, inFlight)
    ).toEqual({ content: "<p>Confirmed</p>", wordCount: confirmed.wordCount });

    const restored = handleNetworkFailure(confirmed, localStillInFlight, inFlight);
    expect(restored.uiHint).toBe("restored");
    expect(restored.localPatch).toEqual({
      content: "<p>Confirmed</p>",
      wordCount: confirmed.wordCount,
    });

    const localMovedOn = {
      content: "<p>Failed save and more</p>",
      title: "Confirmed title",
      status: "draft",
    };
    const kept = handleNetworkFailure(confirmed, localMovedOn, inFlight);
    expect(kept.uiHint).toBe("error");
    expect(kept.localPatch).toBeUndefined();
  });

  it("hasLocalEdits detects unsaved changes against confirmed snapshot", () => {
    const store = new OptimisticChapterStore();
    store.init([chapter({ content: "<p>A</p>", title: "T", status: "draft" })]);

    expect(
      store.hasLocalEdits("ch1", {
        content: "<p>A</p>",
        title: "T",
        status: "draft",
      })
    ).toBe(false);

    expect(
      store.hasLocalEdits("ch1", {
        content: "<p>B</p>",
        title: "T",
        status: "draft",
      })
    ).toBe(true);
  });
});
