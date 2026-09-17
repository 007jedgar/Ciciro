import type { ManuscriptBlock } from "../lib/manuscript";
import {
  assignChapterSlice,
  assignChaptersFromSnapshots,
  CARET_GUARD,
  freezeResumePlace,
  isBackspaceAtStart,
  isGuardDeleted,
  reuseUnchangedBlocks,
  sameLocalDoc,
  sameReadingPosition,
  stripCaretGuard,
  toLogicalOffset,
  toNativeOffset,
  withCaretGuard,
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

describe("caret guard", () => {
  it("treats deleting the leading guard as backspace at the visual start", () => {
    const displayed = withCaretGuard('"Yes," I said.');
    expect(displayed.startsWith(CARET_GUARD)).toBe(true);
    expect(isGuardDeleted('"Yes," I said.', displayed)).toBe(true);
    expect(isGuardDeleted("X", displayed)).toBe(false);
    expect(stripCaretGuard(displayed)).toBe('"Yes," I said.');
    expect(toLogicalOffset(toNativeOffset(0))).toBe(0);
  });

  it("detects a native backspace delta at offset 0", () => {
    expect(isBackspaceAtStart({ key: "Backspace" }, 0, 0)).toBe(true);
    expect(isBackspaceAtStart({ text: "", range: { start: 0, end: 0 } }, 0, 0)).toBe(true);
    expect(isBackspaceAtStart({ text: "", range: { start: 3, end: 4 } }, 4, 4)).toBe(false);
    expect(isBackspaceAtStart({ text: "", range: { start: 0, end: 0 }, isComposing: true }, 0, 0)).toBe(
      false
    );
  });
});
