import type { ManuscriptBlock } from "../lib/manuscript";
import {
  assignChapterSlice,
  assignChaptersFromSnapshots,
  freezeResumePlace,
  overlayReplicaChapters,
  reuseUnchangedBlocks,
  sameLocalDoc,
  sameReadingPosition,
} from "../lib/editor-session";

const block = (id: string, text: string): ManuscriptBlock => ({
  id,
  kind: "paragraph",
  html: `<p data-block-id="${id}">${text}</p>`,
  text,
});

describe("editor session identity", () => {
  it("reuses block objects when id and html already match", () => {
    const previous = [block("b1", "Hello"), block("b2", "world")];
    const parsed = [
      { ...previous[0] },
      { ...previous[1], text: "world.", html: '<p data-block-id="b2">world.</p>' },
    ];
    const reused = reuseUnchangedBlocks(previous, parsed);
    expect(reused[0]).toBe(previous[0]);
    expect(reused[1]).not.toBe(previous[1]);
    expect(reused[1].text).toBe("world.");
    expect(reuseUnchangedBlocks(previous, [{ ...previous[0] }, { ...previous[1] }])).toBe(previous);
  });

  it("keeps the same chapter object when the replica echo is already accurate", () => {
    const chapter = {
      id: "c1",
      content: "<p>Hi</p>",
      revision: 4,
      wordCount: 1,
      title: "Testing",
      summary: "",
      status: "draft",
    };
    const list = [chapter];
    expect(assignChapterSlice(chapter, { ...chapter })).toBe(chapter);
    expect(assignChapterSlice(chapter, { revision: 5 }).revision).toBe(5);
    expect(assignChaptersFromSnapshots(list, [chapter])).toBe(list);
  });

  it("ignores caret-only reading position updates after resume is frozen", () => {
    const first = { chapterId: "c1", blockId: "b2", offset: 0 };
    const later = { chapterId: "c1", blockId: "b2", offset: 12 };
    expect(freezeResumePlace(null, first)).toEqual(first);
    expect(freezeResumePlace(first, later)).toBe(first);
    expect(sameReadingPosition(first, later)).toBe(false);
    expect(sameReadingPosition(first, { ...first })).toBe(true);
    expect(sameLocalDoc({ chapterId: "c1", content: "<p>Hi</p>", revision: 2 }, { chapterId: "c1", content: "<p>Hi</p>", revision: 2 })).toBe(
      true
    );
  });
});

describe("overlayReplicaChapters", () => {
  const server = [
    { id: "c1", content: "<p>server</p>", revision: 4, wordCount: 1, title: "One", summary: "", status: "draft" },
    { id: "c2", content: "<p>server</p>", revision: 1, wordCount: 1, title: "Two", summary: "", status: "draft" },
  ];

  it("keeps replica prose that is as new or newer and yields to a server chapter that is ahead", () => {
    const merged = overlayReplicaChapters(server, [
      { id: "c1", content: "<p>replica</p>", revision: 5, wordCount: 1 },
      { id: "c2", content: "<p>stale replica</p>", revision: 0, wordCount: 2 },
    ]);
    expect(merged[0].content).toBe("<p>replica</p>");
    expect(merged[0].revision).toBe(5);
    expect(merged[0].title).toBe("One");
    expect(merged[1]).toBe(server[1]);
  });

  it("returns the same object when the replica already matches", () => {
    const merged = overlayReplicaChapters(server, [
      { id: "c1", content: "<p>server</p>", revision: 4, wordCount: 1 },
    ]);
    expect(merged[0]).toBe(server[0]);
  });
});
