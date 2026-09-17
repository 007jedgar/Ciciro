import { chapterDrafts, clearChapterDrafts, resetAllDrafts } from "../lib/chapter-drafts";

describe("chapter drafts", () => {
  afterEach(() => resetAllDrafts());

  it("keeps unflushed typing per chapter across component lifetimes", () => {
    chapterDrafts("c1").set("b1", "Hello, still here");
    // A remount asks for the chapter's map again and reads the same buffer.
    expect(chapterDrafts("c1").get("b1")).toBe("Hello, still here");
    expect(chapterDrafts("c2").has("b1")).toBe(false);
    clearChapterDrafts("c1");
    expect(chapterDrafts("c1").has("b1")).toBe(false);
  });
});
