import { describe, expect, it } from "vitest";
import {
  SHARE_PREVIEW_AUTHOR_MAX,
  SHARE_PREVIEW_TITLE_MAX,
  shareKindWord,
  sharePreviewParts,
  sharePreviewSentence,
} from "@/lib/share-preview";

describe("shareKindWord", () => {
  it("maps each manuscript kind to its preview noun", () => {
    expect(shareKindWord("novel")).toBe("novel");
    expect(shareKindWord("screenplay")).toBe("screenplay");
    expect(shareKindWord("blog")).toBe("article");
    expect(shareKindWord("journal")).toBe("journal");
  });

  it("falls back to 'manuscript' for anything that isn't a recognized kind", () => {
    expect(shareKindWord("poem")).toBe("manuscript");
    expect(shareKindWord(null)).toBe("manuscript");
    expect(shareKindWord(undefined)).toBe("manuscript");
    expect(shareKindWord(42)).toBe("manuscript");
  });
});

describe("sharePreviewParts", () => {
  it("passes through a short author and title untouched", () => {
    expect(sharePreviewParts({ author: "Jane Doe", title: "Midnight Harbor", kind: "novel" })).toEqual({
      author: "Jane Doe",
      kindWord: "novel",
      title: "Midnight Harbor",
    });
  });

  it("falls back to a generic author when the project has none set", () => {
    expect(sharePreviewParts({ author: "", title: "Midnight Harbor", kind: "novel" }).author).toBe("A writer");
    expect(sharePreviewParts({ author: "   ", title: "Midnight Harbor", kind: "novel" }).author).toBe("A writer");
  });

  it("falls back to a generic title when the project has none set", () => {
    expect(sharePreviewParts({ author: "Jane Doe", title: "", kind: "novel" }).title).toBe("Untitled Manuscript");
  });

  it("collapses internal whitespace", () => {
    expect(sharePreviewParts({ author: "Jane   \n Doe", title: "Midnight  Harbor", kind: "novel" })).toEqual({
      author: "Jane Doe",
      kindWord: "novel",
      title: "Midnight Harbor",
    });
  });

  it("truncates a very long author gracefully, at a word boundary with an ellipsis", () => {
    const longAuthor = "Alexandra Montgomery-Fitzwilliam the Third of the House of Writers Who Never Stop";
    const { author } = sharePreviewParts({ author: longAuthor, title: "T", kind: "novel" });
    expect(author.length).toBeLessThanOrEqual(SHARE_PREVIEW_AUTHOR_MAX);
    expect(author.endsWith("…")).toBe(true);
    expect(author.endsWith(" …")).toBe(false);
    expect(longAuthor.startsWith(author.slice(0, -1))).toBe(true);
  });

  it("truncates a very long title gracefully, at a word boundary with an ellipsis", () => {
    const longTitle =
      "The Extraordinarily Long and Winding Tale of a Manuscript Whose Title Simply Refuses to Fit on Any Card, No Matter How Wide";
    const { title } = sharePreviewParts({ author: "Jane Doe", title: longTitle, kind: "screenplay" });
    expect(title.length).toBeLessThanOrEqual(SHARE_PREVIEW_TITLE_MAX);
    expect(title.endsWith("…")).toBe(true);
    expect(longTitle.startsWith(title.slice(0, -1))).toBe(true);
  });

  it("falls back to 'manuscript' when the project's kind is unrecognized", () => {
    expect(sharePreviewParts({ author: "Jane Doe", title: "T", kind: "poem" }).kindWord).toBe("manuscript");
    expect(sharePreviewParts({ author: "Jane Doe", title: "T", kind: null }).kindWord).toBe("manuscript");
  });
});

describe("sharePreviewSentence", () => {
  it("reads as '{author} is sending you their {kind} {title}'", () => {
    const parts = sharePreviewParts({ author: "Jane Doe", title: "Midnight Harbor", kind: "screenplay" });
    expect(sharePreviewSentence(parts)).toBe("Jane Doe is sending you their screenplay Midnight Harbor");
  });

  it("reads naturally even with every fallback in play", () => {
    const parts = sharePreviewParts({ author: "", title: "", kind: "unknown-kind" });
    expect(sharePreviewSentence(parts)).toBe("A writer is sending you their manuscript Untitled Manuscript");
  });
});
