import { customChapterTitle } from "../lib/chapter-label";

describe("customChapterTitle", () => {
  it("hides the default numbered name so the list can lead with Chapter N", () => {
    expect(customChapterTitle("Chapter 2", "Chapter 2", "New chapter")).toBeNull();
    expect(customChapterTitle("New chapter", "Chapter 1", "New chapter")).toBeNull();
    expect(customChapterTitle("  ", "Chapter 1", "New chapter")).toBeNull();
    expect(customChapterTitle("The Docks", "Chapter 3", "New chapter")).toBe("The Docks");
  });
});
