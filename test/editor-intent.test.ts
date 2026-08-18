import { describe, expect, it } from "vitest";
import fixture from "./fixtures/malformed-manuscript.json";
import {
  decideReorg,
  looksLikeReorg,
  parseChapterDirections,
  type ChapterShape,
} from "@/lib/reorg";

const chapters: ChapterShape[] = fixture.chapters.map((chapter, index) => ({
  number: index + 1,
  title: chapter.title,
  revision: chapter.revision,
  wordCount: 0,
  sceneCount: 1,
  paragraphCount: 3,
  index: "",
}));

describe("editor intent direction", () => {
  it("classifies the exact reported prompt as reorganization work", () => {
    expect(looksLikeReorg(fixture.prompt)).toBe(true);
  });

  it("keeps poorly-inserted chapter as source and add-to chapter as destination", () => {
    expect(parseChapterDirections(fixture.prompt, chapters)).toEqual({
      source: 1,
      dest: 2,
      all: [1, 2],
    });

    const plan = decideReorg({
      message: fixture.prompt,
      openChapter: 1,
      chapters,
    });
    expect(plan.sourceChapter).toBe(1);
    expect(plan.destChapter).toBe(2);
    expect(plan.kind).not.toBe("not_reorg");
  });

  it("resolves named chapter titles without reversing direction", () => {
    const message =
      `The text was wrongly inserted in ${fixture.chapters[0].title}; ` +
      `move it into ${fixture.chapters[1].title}.`;
    expect(parseChapterDirections(message, chapters)).toMatchObject({
      source: 1,
      dest: 2,
    });
  });
});
